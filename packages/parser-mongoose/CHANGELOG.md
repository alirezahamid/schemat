# @schemat/parser-mongoose

## 0.2.0

### Minor Changes

- [#21](https://github.com/alirezahamid/schemat/pull/21) [`287562a`](https://github.com/alirezahamid/schemat/commit/287562af033f237a13ce8d25c6120f91b38064a9) Thanks [@alirezahamid](https://github.com/alirezahamid)! - Add a Mongoose parser (`@schemat/parser-mongoose`). Schemat now reads Mongoose
  schema definitions by statically parsing the source (via `ts-morph`) — no
  database connection, no code execution. Maps `new Schema({...})` +
  `model('Name', …)` to tables (with an implicit `_id` ObjectId primary key),
  shorthand and options-object fields to columns (required/unique/default/type),
  `enum: [...]` to enums, and `ref` conventions to relations (`ObjectId` ref →
  one-to-many, array-of-ref → many-to-many). Registered in the CLI's parser
  detection so `dev`/`export`/`snapshot`/`check` work on Mongoose projects.

### Patch Changes

- Updated dependencies [[`8db9c83`](https://github.com/alirezahamid/schemat/commit/8db9c8369c0cb6f916dcc89075d81b541f2fc481)]:
  - @schemat/core@0.2.0
