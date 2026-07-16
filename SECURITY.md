# Security Policy

## Supported versions

Schemat is pre-1.0. Security fixes land on the latest published `0.x` release.

| Version | Supported |
| --- | --- |
| latest `0.x` | ✅ |
| older | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately via GitHub Security Advisories:
<https://github.com/alirezahamid/schemat/security/advisories/new>

Or email **alirezahamid1996@gmail.com** with:

- a description of the issue and its impact,
- steps to reproduce (a minimal schema or command),
- affected version(s).

You'll get an acknowledgement within a few days. Once fixed, we'll publish a
patched release and credit you in the advisory (unless you prefer to stay
anonymous).

## Scope notes

Schemat reads schema files from your repo and renders them locally. It does not
connect to your database. The highest-value areas to scrutinize are the parsers
(`@schemat/parser-prisma`, `@schemat/parser-sql`) and the drift-check GitHub
Action, where untrusted schema content flows into rendered output / PR comments.
