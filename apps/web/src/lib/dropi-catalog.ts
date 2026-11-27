/** Productos del catálogo de Dropi para importarlos a Selichat. */
import type { ProductForm } from "@/components/catalog/ProductEditor";

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

/** Producto de Dropi → datos del formulario de producto (lo demás queda como estaba). */
export function formFromDropi(p: DropiCatalogProduct, base: ProductForm): ProductForm {
  return {
    ...base,
    name: p.name.slice(0, 120),
    description:
      base.description ||
      p.description ||
      (p.categories.length ? `Categorías en Dropi: ${p.categories.join(", ")}.` : ""),
    // Precio de venta: el sugerido por el proveedor; si no hay, el de proveedor (ajústalo).
    price: money(p.suggestedPrice) || money(p.cost) || base.price,
    imageUrl: p.imageUrl || base.imageUrl,
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

/** Texto para que la IA arme la ficha a partir de lo que trae Dropi. */
export function dropiSourceText(p: DropiCatalogProduct) {
  return [
    `Producto: ${p.name}`,
    p.categories.length ? `Categorías: ${p.categories.join(", ")}` : "",
    p.suggestedPrice ? `Precio de venta sugerido: ${p.suggestedPrice.toFixed(2)}` : "",
    p.variations.length ? `Variantes: ${p.variations.map((v) => v.name).join(", ")}` : "",
    p.description ? `Descripción del proveedor: ${p.description}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
