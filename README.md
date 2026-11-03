# SONiC babysitter dashboard

[Open the live dashboard](https://securely1g.github.io/sonic-babysitter-dashboard/) · [GitHub Project](https://github.com/users/securely1g/projects/1/views/2)

Read-only progress, blockers, and verified Ready promotions for PRs tracked in the SONiC Project.

The frontend on `main` is served by GitHub Pages. A separate observer publishes an allowlisted snapshot on `live`; that branch contains only the latest snapshot and has no workflows. The page checks the data revision every two minutes and shows its age. Private PR details, worker logs, credentials, and local paths are excluded.

A finished audit does not imply a Ready promotion. Promotions require a matching worker action, PR revision, and GitHub timeline event.
