---
name: clean-ddd-hexagonal
description: Apply when structuring backend code for maintainability as a solo dev or small team. Triggers on dependency inversion, ports and adapters, domain folder, repository interface, use cases, "where does this code go", swapping infrastructure (DB, API, broker), keeping business logic free of framework/IO concerns. Lightweight pragmatic take — not full DDD/CQRS/Event Sourcing.
---

# Lightweight Clean Architecture (solo-dev edition)

A pragmatic subset of Clean Architecture / Hexagonal for one developer. The goal is **two things only**:

1. A **clear domain folder** that holds business logic with zero framework/IO imports.
2. **Dependency inversion** so the domain depends on interfaces, and infrastructure implements them.

Skip everything else (aggregates, CQRS, event sourcing, bounded contexts) until a real pain forces it. Most projects never need them.

## The one rule: dependencies point inward

```
infrastructure  →  application  →  domain
  (adapters)        (use cases)     (core)
```

- **domain** never imports from `application` or `infrastructure`. No DB clients, no HTTP libs, no SDKs.
- **infrastructure** implements interfaces that the domain/application defines.
- Wire concrete implementations together in one place (the composition root / `main`).

Validation: if you can run your business logic from a test with no DB and no network, your boundaries are right.

## Folder layout

```
src/
├── domain/                 # pure business logic, NO external deps
│   ├── <thing>.ts          # entities / value types + their behavior
│   ├── <thing>Service.ts   # logic that doesn't fit on one entity
│   └── ports.ts            # interfaces the domain needs (e.g. Repository)
├── application/            # use cases — orchestrate domain + ports
│   └── <useCase>.ts
├── infrastructure/         # adapters that implement the ports
│   ├── <thing>Repository.ts  # talks to DB / API / disk
│   └── http.ts             # web/bot handlers (driver side)
└── main.ts                 # composition root: build deps, inject, start
```

Start flat. Only split into subfolders when a folder gets crowded. A solo project rarely needs nesting beyond this.

## Dependency inversion in practice

Define the interface where it's *used* (domain/application), implement it in infrastructure.

```ts
// domain/ports.ts  — what the domain needs, not how it's done
export interface DocumentRepository {
  save(doc: Document): Promise<void>;
  findById(id: string): Promise<Document | null>;
}

// application/indexDocument.ts — depends on the interface only
export class IndexDocument {
  constructor(private readonly repo: DocumentRepository) {}
  async run(doc: Document) {
    // business orchestration, no idea what DB is behind repo
    await this.repo.save(doc);
  }
}

// infrastructure/sqliteDocumentRepository.ts — the concrete adapter
export class SqliteDocumentRepository implements DocumentRepository {
  constructor(private readonly db: Database) {}
  async save(doc: Document) { /* SQLite specifics */ }
  async findById(id: string) { /* ... */ return null; }
}

// main.ts — composition root: the ONLY place that knows concretes
const repo = new SqliteDocumentRepository(db);
const indexDocument = new IndexDocument(repo);
```

Benefit: swap `SqliteDocumentRepository` for `PostgresDocumentRepository` or a fake in tests — nothing in `domain`/`application` changes.

## "Where does this code go?"

```
├─ Pure logic, no I/O                       → domain/
├─ Coordinates domain + has side effects    → application/
├─ Talks to DB / HTTP / disk / SDK          → infrastructure/
├─ An interface describing a need           → port (domain/application)
└─ Implements that interface                → adapter (infrastructure)
```

## Keep behavior on your objects

Put logic next to the data it uses, not in a pile of service functions.

```ts
// Good: behavior lives on the entity
class Password {
  constructor(private readonly value: string) {
    if (value.length < 1) throw new Error("empty password");
  }
  matches(input: string) { return this.value === input; }
}

// Avoid: anemic data bag + external logic
// type Password = { value: string }
// function passwordMatches(p, input) { ... }
```

## Anti-patterns to avoid

| Anti-pattern | Fix |
|--------------|-----|
| Domain imports DB/HTTP/SDK libs | Move IO behind a port; domain stays pure |
| Logic scattered in "service" functions, data in plain types | Put behavior on the type that owns the data |
| `new SqliteRepo()` inside a use case | Inject it; construct only in `main.ts` |
| One interface per DB table | Model around a meaningful unit, not the schema |
| Reaching for CQRS / events early | Don't. Add only when reads/writes truly diverge |

## When to add more (and not before)

- **Multiple bounded contexts / aggregates** — only with a genuinely complex domain.
- **CQRS** — only when read and write models really diverge.
- **Event sourcing** — only when you need full history/audit/replay.

If you're unsure, you don't need it yet.

## Sources

- [The Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html) — Robert C. Martin
- [Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/) — Alistair Cockburn
- [Dependency Inversion Principle](https://martinfowler.com/articles/dipInTheWild.html) — Martin Fowler
