import { describe, expect, it } from "vitest";
import type { SchemaChange } from "@alirezahamid/schemat-core";
import { renderDiffMarkdown, renderDiffText } from "../src/diff";

const changes: SchemaChange[] = [
  { kind: "table.added", table: "Comment" },
  { kind: "table.removed", table: "LegacyThing" },
  { kind: "column.added", table: "User", column: "avatarUrl" },
  { kind: "column.removed", table: "User", column: "nickname" },
  {
    kind: "column.changed",
    table: "Post",
    column: "status",
    before: "string",
    after: "PostStatus",
  },
  { kind: "relation.added", name: "Comment_postId_fkey" },
];

describe("renderDiffText", () => {
  it("returns a no-changes line for an empty diff", () => {
    expect(renderDiffText([])).toBe("No schema changes.\n");
  });

  it("renders each change kind with a marker and a summary", () => {
    const out = renderDiffText(changes);
    expect(out).toContain("+ table   Comment");
    expect(out).toContain("- table   LegacyThing");
    expect(out).toContain("+ column  User.avatarUrl");
    expect(out).toContain("- column  User.nickname");
    expect(out).toContain("~ column  Post.status  (string → PostStatus)");
    expect(out).toContain("+ relation Comment_postId_fkey");
    expect(out).toContain("6 change(s): +3 added, -2 removed, ~1 changed");
  });

  it("is deterministic", () => {
    expect(renderDiffText(changes)).toBe(renderDiffText(changes));
  });
});

describe("renderDiffMarkdown", () => {
  it("shows a green up-to-date block when there are no changes", () => {
    const md = renderDiffMarkdown([]);
    expect(md).toContain("🟢");
    expect(md).toContain("up to date");
  });

  it("shows a red drift block with a fenced diff when there are changes", () => {
    const md = renderDiffMarkdown(changes);
    expect(md).toContain("🔴");
    expect(md).toContain("out of date");
    expect(md).toContain("```diff");
    expect(md).toContain("+ table   Comment");
    expect(md).toContain("schemat snapshot");
  });
});
