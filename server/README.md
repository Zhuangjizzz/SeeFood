# Local service

From the repository root, run `npm ci` and `npm run server:dev` with Node.js 26 or later. The service uses actual HTTP, SQLite and image files, with fixed generation adapters. See [local development](../docs/technical/local-development.md) for connection steps, every runtime setting, failure scenarios and limits. See [validation](../docs/technical/validation/2026-10-06-core.md) for executed checks and remaining device/production work.

The default listener is `127.0.0.1:8787`. Data stays outside the repository at `~/.seefood/development`; `SEEFOOD_DATA_DIR` selects another directory. Restart with the same directory to recover accepted work. Development identities are explicitly enabled by `server:dev` and are disabled by the launcher in production. Real WeChat session verification and cloud deployment remain separate integration work.

## Request lifecycle

1. Publish a frozen record or communication snapshot. For images, request an upload ticket, transfer the actual bytes, confirm the asset, then publish a new snapshot binding it. Upload completion alone does not create generation jobs.
2. Submit `image_cards`, `image_translation`, `chat`, `dietary_review` or `text_translation` to the shared job endpoint. Acceptance stores the immutable request, snapshot, assets and idempotency response before returning 202. `server/jobs.ts` executes work outside HTTP requests and resumes queued/interrupted jobs after restart. This is a single-process executor.
3. Query the job or paginate its context job list to recover associations after lost responses. Retry explicitly with the expected attempt and original input. Every new attempt keeps the job ID and increases the revision. Dietary target IDs and input cards compare as sets; image and message ordering retain their meaning.
4. Deliver real translated PNGs through expiring, owner-authenticated URLs. Query the same job to renew its URL without changing the artifact or business revision. The client saves originals and translations independently and can retry local saving without generation.
5. Accept display/save acknowledgements separately. Server delivery records prevent acknowledgement of an undelivered revision or artifact. Optional early collection requires complete current saving and no active dependencies; hard expiry fences writes and removes temporary materials. Explicit deletion uses the same owner boundary and durable cleanup process.

The [OpenAPI](../docs/technical/openapi.json) defines exact fields and errors. [Technical design](../docs/technical/design.md) defines cross-object ownership, snapshots, retries, deletion and expiry. Expired or deleted context identities cannot be reused. Client history and independently saved communication cards remain local.

## Implementation entry points

| Change | Entry point |
| --- | --- |
| HTTP, development identity, snapshots, upload bytes and assets | `service.ts` |
| Acceptance, stable targets, retries and durable execution | `jobs.ts` |
| Schema validation, canonical objects and API errors | `contract.ts` |
| Fixed generation and output relationship checks | `image-cards.ts`, `image-translation.ts`, `chat.ts`, `dietary-review.ts`, `text-translation.ts` |
| Delivery and save watermarks | `receipts.ts` |
| Deletion and temporary-material collection | `cleanups.ts`, `retention.ts` |

To add a generation stage, provide a `JobHandler` through `createService({jobHandlers})`: `prepare` validates frozen input relationships within the acceptance transaction, `generate` runs at the provider boundary, and `validateOutput` checks returned relationships. Execution verifies real asset bytes and current attempt/revision before publishing. Runtime fault controls remain configuration, not extra business request fields.

Run `npm run typecheck` and `npm test` from the repository root. Tests replace the generation provider, clock or platform boundaries where needed; successful HTTP, database persistence and image transfers use the actual implementation. Simulator checks run against the integrated checkout. Fixed output quality and timing provide no evidence of real AI quality or production performance.
