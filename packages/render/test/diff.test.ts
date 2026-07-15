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

  it("uses a fence that can't be broken by backticks in a schema name", () => {
    // A table name containing a triple-backtick would break a plain ``` fence.
    const evil: SchemaChange[] = [{ kind: "table.added", table: "we``` ird```` name" }];
    const md = renderDiffMarkdown(evil);
    // The opening/closing fence must be LONGER than the longest backtick run
    // in the body (4 here), so the block can't be terminated early.
    const fenceMatch = md.match(/\n(`{4,})diff\n/);
    expect(fenceMatch).not.toBeNull();
    const fence = fenceMatch?.[1] ?? "";
    // Body's longest backtick run is 4 → fence is at least 5.
    expect(fence.length).toBeGreaterThanOrEqual(5);
    // And the block is properly closed with the same fence.
    expect(md.trimEnd().endsWith(fence)).toBe(true);
  });
});
