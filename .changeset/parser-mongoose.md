---
"@schemat/parser-mongoose": minor
"@schemat/cli": minor
---

Add a Mongoose parser (`@schemat/parser-mongoose`). Schemat now reads Mongoose
schema definitions by statically parsing the source (via `ts-morph`) — no
database connection, no code execution. Maps `new Schema({...})` +
`model('Name', …)` to tables (with an implicit `_id` ObjectId primary key),
shorthand and options-object fields to columns (required/unique/default/type),
`enum: [...]` to enums, and `ref` conventions to relations (`ObjectId` ref →
one-to-many, array-of-ref → many-to-many). Registered in the CLI's parser
detection so `dev`/`export`/`snapshot`/`check` work on Mongoose projects.
