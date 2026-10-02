# Zig Parslet authoring reference

## Grammar syntax

```peg
root greeting
greeting <- "Hi " who:[a-zA-Z]+

@test "name" { input: "Hi World" expect: { who: "World" } }
@test "missing" { input: "Hi " reject: true }
```

Rules begin on separate lines and may span lines. `#` starts a comment. Grammar whitespace separates expressions; document whitespace must be matched explicitly. Every parse must consume the whole document.

| Expression | Meaning |
| --- | --- |
| `"text"` or `'text'` | Literal |
| `[a-z]`, `[^\"]`, `[\x00-\x1f]` | Byte classes, inversion, hex ranges |
| `.` | One byte |
| `rule_name` | Rule reference |
| `a b`, `(a b)` | Sequence, grouping |
| `a / b` | Ordered choice |
| `a*`, `a+`, `a?` | Zero-or-more, one-or-more, optional |
| `!a`, `&a` | Non-consuming negative/positive lookahead |
| `name:a` | Capture |

Unlike regex backtracking, `( "a" / "ab" ) "c"` rejects `abc`. The successful `"a"` choice is not reopened when `"c"` fails. Repetition is greedy and does not give characters back to a later expression.

No left recursion. Write expression chains as `term (operator term)*`, not `expr operator term / term`. Never repeat a nullable expression, including optional expressions and lookahead. Resource limits are errors, not ordinary rejection-test successes.

Use `@test(subject) "label" { input: "Hello" expect: "Hello" }` to test a named rule directly. Plain `@test "label"` uses the root. Both require the entire input to match. Forward rule references work; unknown test targets fail when loading tests, but parse-only mode skips target resolution. Keep a root declaration even when all tests select helpers.

Tests accept JSON-style values, bare object keys and optional commas. Each needs a string `input` and exactly one `expect` or `reject: true`. Use `\n` inside input strings. Numeric literals use JSON syntax, not `01` or `1.`.

## Capture shapes

| Grammar expression | Input | Tree |
| --- | --- | --- |
| `word:[a-z]+` | `ab` | `{"word":"ab"}` |
| `(letter:[a-z])+` | `a` | `[{"letter":"a"}]` |
| `(letter:[a-z])+` | `ab` | `[{"letter":"a"},{"letter":"b"}]` |
| `"(" word:[a-z]+ ")"` | `(ab)` | `{"word":"ab"}` |
| `x:"a" x:"b"` | `ab` | `{"x":"b"}` |
| `outer:(inner:"a")` | `a` | `{"outer":{"inner":"a"}}` |
| `(letter:[a-z])*` | empty | `""` |

Uncaptured text joins. Captures discard uncaptured text in their sequence. Adjacent capture objects merge, with later duplicate keys winning. Structured repetition produces arrays, even for one item, but zero matches produce `""`. Mixing capture objects and arrays in a sequence flattens their structured items.

Capture scope matters: `word:[a-z]+` wraps a whole word; `(letter:[a-z])+` repeats a capture. Wrapping another capture preserves its tree, not the original text.

## Transform syntax

```text
{ digits: simple(n) } => int(n)
{ parts: sequence(xs) } => join(xs, ",")
{ wrapper: subtree(value) } => value
```

Objects match exact keys; array patterns match exact lengths. `simple(x)` binds a scalar, `sequence(xs)` an array of scalars, and `subtree(x)` any value. Repeated binding names require deep equality.

Children transform before parents. The first matching rule applies once; unmatched nodes remain unchanged. Replacement values are not revisited. Write specific rules before broad ones and inspect the child's transformed shape when debugging a parent rule.

For nested containers, keep tagged element/entry wrappers until the container reduces. Otherwise a scalar, singleton array and nested array can become indistinguishable. The checkout's `examples/json.peg` and `examples/json.pegtx` demonstrate this pattern.

A repeated binding can match equal opening/closing tag names, but unequal names merely leave a node unmatched. Use `require_equal(open, close)` in the output expression when mismatches must fail. The XML example checks tag equality during transformation, so parse-only success is not validation.

| Output helper | Contract |
| --- | --- |
| `concat(a, ...)` | Convert scalars to text and concatenate |
| `join(xs[, separator])` | Join scalar array; default separator is empty |
| `int(x)` | Signed 64-bit integer; no fractional/out-of-range conversion |
| `float(x)` | Finite double, potentially lossy |
| `bool(x)` | Boolean or string `"true"`/`"false"` |
| `unquote(text)` | Decode exactly one quoted JSON string token, not CSV escaping |
| `number(text)` | Validate JSON numeric syntax, preserving exact spelling/precision |
| `pluck(xs, "key")` | Extract that field from every object; missing keys fail |
| `from_entries(xs)` | Exact `{key: string, value: any}` entries to object; duplicate keys last-wins |
| `require_equal(a, b)` | Return `a` when deeply equal to `b`; otherwise runtime error |

Output objects and argument lists require commas. No arbitrary host-language code or unlisted helpers. Conversion errors fail rather than silently coercing. Number-literal matching is representation-sensitive; integer, float and preserved numeric-token values differ.

## Encoding and existing examples

Matching is byte-oriented. UTF-8 literals work, but `.` and classes are not Unicode code-point matchers. Copy explicit UTF-8 validation rules from the JSON/CSV examples when required.

Use the checkout's examples as references, not standards-compliance claims:

- `examples/email.*`: captures and string reconstruction, not full RFC email validation.
- `examples/json.*`: wrapper-preserving nested containers, exact numbers, escapes and surrogate pairs.
- `examples/csv.*`: quoting, multiline cells, empty fields, no automatic type conversion.
- `examples/xml.*`: nested/mixed elements, named entities and tag-name validation, without attributes, namespaces or DTDs.

Files/stdin are bounded to 16 MiB; grammar source to 4 MiB. Parsing has depth/work limits and no packrat memoization. Test representative larger documents rather than promising linear performance.
