# Contributing to MuaCloud Client

Before changing product behavior, read `docs/CLIENT_CONTRACT.md`. It is the source of truth for Xboard API contracts, authentication, subscription tokens, checkout, entitlement validation, startup bootstrap, API failover, and remote configuration compatibility.

Keep changes scoped, verify the affected platform, and avoid hard-coding commercial rules in the client. Any requested behavior that needs new backend data or rules must be added to the contract first.
