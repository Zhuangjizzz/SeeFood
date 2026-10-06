# Legacy dietary idempotency fixture

`metadata.sqlite.gz` is an actual SQLite directory snapshot produced by the pre-fix service at `0bfeca12850d9f8337aae91a9a926cceec38201b`. `request.json` records the original unsorted request, request key, job ID and controlled clock. The service accepted a restored local record with two fixed example cards through HTTP, ran its dietary check to completion, replayed the original request successfully, and closed normally before compression. No SQL rows were fabricated or edited.

The upgrade test opens this persisted directory in the current service and uses only public HTTP operations. It proves that the original key and semantically reordered sets still identify the same completed job. Test data contains only synthetic cards and the development owner; it has no user content or live credentials. The original-image asset is intentionally absent because the supported restored-history snapshot contains saved dish text.

Regenerate only when deliberately changing this compatibility fixture. Prepare a separate checkout at the revision above and run `npm ci` there, then from the current repository run:

```sh
node tests/fixtures/legacy-dietary-idempotency/generate.cjs /path/to/legacy/SeeFood
```

The generator calls the old service's real HTTP interface, stores data in a temporary directory, and updates these two fixture files after closing the service. Normal tests do not run the generator or require the old checkout.
