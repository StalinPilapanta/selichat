/** Productos del catálogo de Dropi para importarlos a Selichat. */
import type { ProductForm } from "@/components/catalog/ProductEditor";
import { api, errorMessage } from "@/lib/api";

export type DropiCatalogProduct = {
  id: string;
  name: string;
  sku: string;
  description: string;
  cost: number | null;
  suggestedPrice: number | null;
  stock: number | null;
  imageUrl: string;
  images: string[];
  categories: string[];
  variations: { id: string; name: string; price: number | null }[];
};

const money = (n: number | null) => (n != null && n > 0 ? n.toFixed(2) : "");

/**
 * Descripción inicial con lo que Dropi dice del producto: la descripción del proveedor (si la da),
 * sus categorías y variantes. La lee el agente de ventas, así que no lleva precio de proveedor ni
 * stock; con «Crear con IA» se arma una descripción completa a partir de las fotos.
 */
export function dropiDetails(p: DropiCatalogProduct) {
  return [
    p.description,
    p.categories.length ? `Categorías: ${p.categories.join(", ")}.` : "",
    p.variations.length ? `Presentaciones: ${p.variations.map((v) => v.name).join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Producto de Dropi → datos del formulario de producto (lo demás queda como estaba). */
export function formFromDropi(p: DropiCatalogProduct, base: ProductForm): ProductForm {
  return {
    ...base,
    name: p.name.slice(0, 120),
    description: (base.description || dropiDetails(p)).slice(0, 4000),
    // Precio de venta: el sugerido por el proveedor; si no hay, el de proveedor (ajústalo).
    price: money(p.suggestedPrice) || money(p.cost) || base.price,
    imageUrl: p.imageUrl || base.imageUrl,
    // Fotos del proveedor como multimedia del embudo inicial (se pueden cambiar de uso o quitar).
    media: base.media.length
      ? base.media
      : p.images.slice(0, 3).map((url) => ({
          kind: "image" as const,
          url,
          usage: "inicial" as const,
          caption: "",
        })),
    dropiProductId: p.id,
    variantType: p.variations.length ? "VARIABLE" : "SIMPLE",
    variants: p.variations.map((v) => ({
      name: v.name.slice(0, 120),
      attributes: {},
      price: money(v.price) || null,
      dropiVariationId: v.id || null,
    })),
  };
}

/**
 * Ficha para la IA con todo lo que trae Dropi. Las fotos se envían aparte para que la IA lea el
 * empaque. El usuario puede agregar debajo beneficios, modo de uso u ofertas.
 */
export function dropiSourceText(p: DropiCatalogProduct) {
  return [
    `Producto: ${p.name}`,
    p.categories.length ? `Categorías: ${p.categories.join(", ")}` : "",
    p.suggestedPrice ? `Precio de venta sugerido: ${p.suggestedPrice.toFixed(2)}` : "",
    p.variations.length ? `Variantes: ${p.variations.map((v) => v.name).join(", ")}` : "",
    p.stock != null ? `Stock disponible: ${p.stock}` : "",
    p.description ? `Descripción del proveedor: ${p.description}` : "",
    p.images.length
      ? `Fotos del producto: ${p.images.length} (van adjuntas para que la IA lea el empaque).`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Detalle del producto leído de sus fotos con la IA (Dropi no entrega la descripción del
 * proveedor). Nunca lanza: devuelve el texto o el motivo por el que no se pudo.
 */
export async function describeFromPhotos(
  p: DropiCatalogProduct,
): Promise<{ text: string | null; error?: string }> {
  if (!p.images.length) return { text: null, error: "El producto no tiene fotos en Dropi." };
  try {
    const r = await api<{ description: string }>("/api/ai/describe-product", {
      method: "POST",
      body: { name: p.name, categories: p.categories, imageUrls: p.images.slice(0, 4) },
    });
    return { text: r.description || null };
  } catch (e) {
    return { text: null, error: errorMessage(e) };
  }
}

/** Descripción del producto: lo leído en las fotos y, debajo, categorías y presentaciones. */
export const describedText = (p: DropiCatalogProduct, fromPhotos: string) =>
  [fromPhotos.trim(), dropiDetails(p)].filter(Boolean).join("\n\n").slice(0, 4000);
