import { test, expect } from "bun:test";
import { statements } from "./load-turso.mjs";

const split = (sql) => [...statements(sql)];

test("splits on top-level semicolons, trims, drops the trailing ;", () => {
  expect(split("INSERT INTO t VALUES (1); INSERT INTO t VALUES (2);")).toEqual([
    "INSERT INTO t VALUES (1)",
    "INSERT INTO t VALUES (2)",
  ]);
});

test("a semicolon inside a string literal is NOT a boundary", () => {
  expect(split("INSERT INTO t VALUES ('a;b;c');")).toEqual([
    "INSERT INTO t VALUES ('a;b;c')",
  ]);
});

test("doubled '' escape keeps the string open (semicolon stays literal)", () => {
  expect(split("INSERT INTO t VALUES ('it''s; fine');")).toEqual([
    "INSERT INTO t VALUES ('it''s; fine')",
  ]);
});

test("-- line comments between statements are skipped", () => {
  const sql = "-- corpus chunk 1\nINSERT INTO t VALUES (1);\n-- next\nINSERT INTO t VALUES (2);";
  expect(split(sql)).toEqual(["INSERT INTO t VALUES (1)", "INSERT INTO t VALUES (2)"]);
});

test("'--' inside a string is literal, not a comment", () => {
  expect(split("INSERT INTO t VALUES ('a -- not a comment; really');")).toEqual([
    "INSERT INTO t VALUES ('a -- not a comment; really')",
  ]);
});

test("a final statement without a trailing semicolon is still yielded", () => {
  expect(split("INSERT INTO t VALUES (1)")).toEqual(["INSERT INTO t VALUES (1)"]);
});

test("multi-line multi-row INSERT (the seed's shape) is one statement", () => {
  expect(split("INSERT INTO t(a) VALUES\n(1),\n(2),\n(3);\n")).toEqual([
    "INSERT INTO t(a) VALUES\n(1),\n(2),\n(3)",
  ]);
});

test("FTS5 'delete-all' command parses as one statement", () => {
  expect(split("INSERT INTO dict_fts(dict_fts) VALUES('delete-all');")).toEqual([
    "INSERT INTO dict_fts(dict_fts) VALUES('delete-all')",
  ]);
});

test("blank input and comment-only input yield nothing", () => {
  expect(split("")).toEqual([]);
  expect(split("-- just a comment\n  \n")).toEqual([]);
});
