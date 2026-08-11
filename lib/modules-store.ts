// The module store, as the browser sees it.
//
// This is a barrel, not an implementation. It was one 678-line file when the
// store was a JSON document and the page read and wrote the whole thing; the
// store is SQLite now, reached one module at a time, so the file split into the
// three things it had grown into:
//
//   modules/schema.ts     what a module is — SPEC, normalize, verify.
//                         No I/O, no environment: the browser, the API routes
//                         and the database layer all import this same file, so
//                         there is exactly one description of the schema.
//   modules/client.ts     talking to /api/modules. Reads, and one request per
//                         edit, queued so they land in order.
//   modules/serialize.ts  the modules.json format — now an export and a seed
//                         rather than the store itself.
//
// Components import from here and get all three. Server code imports
// modules/schema directly: nothing on the server should be able to reach the
// browser's fetch calls by accident.

export * from './modules/schema';
export * from './modules/client';
export * from './modules/serialize';
