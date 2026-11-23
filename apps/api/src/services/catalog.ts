import { schema, type Tx } from "@chatea/db";
import type { CatalogForPrompt, ProductData, PromptScope } from "@chatea/shared";
import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";

const {
  products,
  productOffers,
  productVariants,
  productMedia,
  productFaqs,
  productTriggers,
  productUpsells,
  prompts,
} = schema;

export class TriggerConflictError extends Error {
  constructor(
    public trigger: { kind: string; value: string },
    public productName: string,
  ) {
    super("trigger_conflict");
  }
}

/** Carga un producto con todos sus hijos (dentro de withTenant). */
export async function loadProduct(tx: Tx, id: string) {
  const [product] = await tx.select().from(products).where(eq(products.id, id));
  if (!product) return null;
  const byPos = <T extends { productId: unknown }>(t: T) => eq(t.productId as never, id);
  const [offers, variants, media, faqs, triggers, upsells] = await Promise.all([
    tx
      .select()
      .from(productOffers)
      .where(byPos(productOffers))
      .orderBy(asc(productOffers.position)),
    tx
      .select()
      .from(productVariants)
      .where(byPos(productVariants))
      .orderBy(asc(productVariants.position)),
    tx.select().from(productMedia).where(byPos(productMedia)).orderBy(asc(productMedia.position)),
    tx.select().from(productFaqs).where(byPos(productFaqs)).orderBy(asc(productFaqs.position)),
    tx
      .select()
      .from(productTriggers)
      .where(byPos(productTriggers))
      .orderBy(asc(productTriggers.kind)),
    tx
      .select()
      .from(productUpsells)
      .where(byPos(productUpsells))
      .orderBy(asc(productUpsells.position)),
  ]);
  return { ...product, offers, variants, media, faqs, triggers, upsells };
}
export type FullProduct = NonNullable<Awaited<ReturnType<typeof loadProduct>>>;

/** Verifica que ningún disparador ya pertenezca a otro producto del tenant. */
async function assertTriggersFree(tx: Tx, data: ProductData, productId?: string) {
  for (const t of data.triggers) {
    const [hit] = await tx
      .select({ productId: productTriggers.productId, name: products.name })
      .from(productTriggers)
      .innerJoin(products, eq(products.id, productTriggers.productId))
      .where(and(eq(productTriggers.kind, t.kind), eq(productTriggers.value, t.value)));
    if (hit && hit.productId !== productId) throw new TriggerConflictError(t, hit.name);
  }
}

/** Crea o reemplaza un producto completo (base + hijos) en una sola transacción. */
export async function saveProduct(
  tx: Tx,
  data: ProductData,
  opts: { id?: string; externalRef?: Record<string, string> } = {},
) {
  await assertTriggersFree(tx, data, opts.id);
  const base = {
    name: data.name,
    description: data.description,
    kind: data.kind,
    status: data.status,
    price: data.price,
    currency: data.currency,
    variantType: data.variantType,
    imageUrl: data.imageUrl,
    dropiProductId: data.dropiProductId,
    initialMessage: data.initialMessage,
    entryQuestion: data.entryQuestion,
    followUps: data.followUps,
  };

  let id = opts.id;
  if (id) {
    const updated = await tx
      .update(products)
      .set(base)
      .where(eq(products.id, id))
      .returning({ id: products.id });
    if (!updated.length) return null;
    await Promise.all(
      [
        productOffers,
        productVariants,
        productMedia,
        productFaqs,
        productTriggers,
        productUpsells,
      ].map((t) => tx.delete(t).where(eq(t.productId, id as string))),
    );
  } else {
    const [row] = await tx
      .insert(products)
      .values({ ...base, externalRef: opts.externalRef ?? null })
      .returning({ id: products.id });
    id = row?.id as string;
  }

  const pid = id as string;
  const withPos = <T>(items: T[]) =>
    items.map((x, position) => ({ ...x, productId: pid, position }));
  if (data.offers.length) await tx.insert(productOffers).values(withPos(data.offers));
  if (data.variants.length) await tx.insert(productVariants).values(withPos(data.variants));
  if (data.media.length) await tx.insert(productMedia).values(withPos(data.media));
  if (data.faqs.length) await tx.insert(productFaqs).values(withPos(data.faqs));
  if (data.triggers.length)
    await tx.insert(productTriggers).values(data.triggers.map((t) => ({ ...t, productId: pid })));
  if (data.upsells.length) await tx.insert(productUpsells).values(withPos(data.upsells));
  return pid;
}

/** Versión activa = la publicada más recientemente. */
export async function activePrompt(tx: Tx, scope: PromptScope, productId: string | null) {
  const [row] = await tx
    .select()
    .from(prompts)
    .where(
      and(
        eq(prompts.scope, scope),
        productId ? eq(prompts.productId, productId) : isNull(prompts.productId),
        isNotNull(prompts.publishedAt),
      ),
    )
    .orderBy(desc(prompts.publishedAt))
    .limit(1);
  return row ?? null;
}

export async function latestPrompt(tx: Tx, scope: PromptScope, productId: string | null) {
  const [row] = await tx
    .select()
    .from(prompts)
    .where(
      and(
        eq(prompts.scope, scope),
        productId ? eq(prompts.productId, productId) : isNull(prompts.productId),
      ),
    )
    .orderBy(desc(prompts.version))
    .limit(1);
  return row ?? null;
}

export function catalogForPrompt(
  p: FullProduct,
  tenant: { name: string; country: string },
): CatalogForPrompt {
  return {
    tenantName: tenant.name,
    country: tenant.country,
    currency: p.currency,
    product: {
      name: p.name,
      description: p.description,
      price: p.price,
      initialMessage: p.initialMessage,
      entryQuestion: p.entryQuestion,
    },
    offers: p.offers,
    variants: p.variants,
    faqs: p.faqs,
    upsells: p.upsells,
    media: p.media,
  };
}
