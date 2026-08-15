import { describe, expect, it } from "vitest";
import { isCanonicalType, mapToCanonicalType } from "../src/index";

describe("mapToCanonicalType", () => {
  it("maps common Prisma / SQL / ORM strings onto the closed vocabulary", () => {
    expect(mapToCanonicalType("String")).toBe("string");
    expect(mapToCanonicalType("Int")).toBe("int");
    expect(mapToCanonicalType("BigInt")).toBe("bigint");
    expect(mapToCanonicalType("Boolean")).toBe("boolean");
    expect(mapToCanonicalType("DateTime")).toBe("datetime");
    expect(mapToCanonicalType("Json")).toBe("json");
    expect(mapToCanonicalType("Bytes")).toBe("bytes");
    expect(mapToCanonicalType("Decimal")).toBe("decimal");
    expect(mapToCanonicalType("Float")).toBe("float");

    expect(mapToCanonicalType("varchar")).toBe("string");
    expect(mapToCanonicalType("VARCHAR(255)")).toBe("string");
    expect(mapToCanonicalType("character varying")).toBe("string");
    expect(mapToCanonicalType("INTEGER")).toBe("int");
    expect(mapToCanonicalType("serial")).toBe("int");
    expect(mapToCanonicalType("bigserial")).toBe("bigint");
    expect(mapToCanonicalType("timestamptz")).toBe("datetime");
    expect(mapToCanonicalType("timestamp with time zone")).toBe("datetime");
    expect(mapToCanonicalType("date")).toBe("date");
    expect(mapToCanonicalType("uuid")).toBe("uuid");
    expect(mapToCanonicalType("jsonb")).toBe("json");
    expect(mapToCanonicalType("bytea")).toBe("bytes");
    expect(mapToCanonicalType("numeric(10,2)")).toBe("decimal");

    expect(mapToCanonicalType("number")).toBe("int");
    expect(mapToCanonicalType("timestamp")).toBe("datetime");
    expect(mapToCanonicalType("ObjectId")).toBe("string");
    expect(mapToCanonicalType("text")).toBe("string");
  });

  it("never returns free-form text", () => {
    expect(mapToCanonicalType("CustomId")).toBe("unknown");
    expect(mapToCanonicalType("MyWeirdType")).toBe("unknown");
    expect(mapToCanonicalType("")).toBe("unknown");
  });

  it("isCanonicalType gates the closed set", () => {
    expect(isCanonicalType("string")).toBe(true);
    expect(isCanonicalType("varchar")).toBe(false);
  });
});
