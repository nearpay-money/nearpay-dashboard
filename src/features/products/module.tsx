/** Products & prices module (lld/billing.md §5, spec `billing-catalog`): Billing → Products, product detail. */
import { getProduct, listProducts } from "@nearpay-money/spec";
import { lazyPage } from "../../app/lazy";
import { defineFeature } from "../../app/registry";

const ProductsTab = lazyPage(() => import("./Products"), "ProductsTab", "Loading products");
const ProductDetail = lazyPage(() => import("./ProductDetail"), "ProductDetail", "Loading product");

export default defineFeature({
  id: "products",
  routes: [
    {
      name: "products",
      pattern: "/billing/products",
      section: "billing",
      title: "Products",
      stage: 3,
      roles: listProducts.roles,
      render: () => <ProductsTab />,
    },
    {
      name: "product",
      pattern: "/billing/products/:id",
      section: "billing",
      title: "Product",
      stage: 3,
      roles: getProduct.roles,
      render: (p) => <ProductDetail id={p.id ?? ""} />,
    },
  ],
});
