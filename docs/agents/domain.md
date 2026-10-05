# Domain Docs

This repo uses a single-context domain layout.

## Before exploring, read these

- `GLOSSARY.md` at the repo root, for the project's domain vocabulary.
- ADRs in `docs/adr/` that touch the area you are about to work in.

If either is missing, proceed silently. The `domain-modeling` skill creates domain docs lazily when terms or decisions are resolved.

## File structure

- `GLOSSARY.md`: shared domain terms and definitions.
- `docs/adr/NNNN-short-title.md`: numbered architecture decision records.

## Use the glossary's vocabulary

Use glossary terms when naming domain concepts in issue titles, proposals, hypotheses, and tests. Follow any distinctions and avoided synonyms recorded there.

If a needed concept is missing, check whether the project already uses another term. Record a genuine vocabulary gap for `domain-modeling`.

## Flag ADR conflicts

If a proposal contradicts an existing ADR, identify the ADR and explain why the decision should be revisited before changing the documented direction.
