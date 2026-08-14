/**
 * "Kategoriya turi" — the shop's own list, not a fixed pair.
 *
 * It began as a hard-coded `['sports', 'casual']` repeated across six pages, which made it the one
 * descriptive field on a product that could not take a new value: category, brand, model, size and
 * colour all accept whatever is typed and remember it. A shop that starts selling bags had nowhere
 * to file them.
 *
 * The list is therefore derived from the products themselves, with the two original values always
 * offered first so an empty database still has something sensible to pick. Labels come from the
 * translations when the value is one of those two, and otherwise show exactly what was typed —
 * translating a word the shop invented is not something a locale file can do.
 */

/**
 * **Deriving the list from the page's own rows is not enough.** Inventory, Orders, Sales and
 * Returns each list their own records, and a type invented on a brand-new product appears in none
 * of them yet — so the new type showed up on Mahsulotlar and nowhere else. The products table is
 * the only place that knows every type that exists, so `useProductCategoryTypes` asks it, and each
 * page unions that with whatever its own rows carry (which covers a product deleted or edited
 * since, whose old type a row still holds).
 */
import { useEffect, useState } from 'react';
import api from './api';

/** The values the system shipped with. Offered first; never the whole list. */
export const SEEDED_PRODUCT_CATEGORY_TYPES = ['sports', 'casual'];

/** Every type any product uses. Fetched once per mount; failure just falls back to the seeds. */
export function useProductCategoryTypes() {
  const [known, setKnown] = useState([]);
  useEffect(() => {
    let cancelled = false;
    api
      .get('/products/category_types/')
      .then((res) => {
        if (!cancelled) setKnown(res.data?.category_types || []);
      })
      .catch(() => {
        // A filter that silently loses the shop's own types is bad; a page that fails to open
        // because a lookup timed out is worse. The seeds and the page's own rows still show.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return known;
}

/** Display text for one value: translated when known, shown as typed when not. */
export function categoryTypeLabel(value, t) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return t(`categoryTypes.${raw}`, { defaultValue: raw });
}

/**
 * Every type worth offering, seeded values first and the shop's own after, each de-duplicated.
 *
 * `products` may be products, inventory items, orders — anything with a `category_type`, directly
 * or under a `product_detail`. Pass a picker when it lives somewhere else.
 */
export function productCategoryTypeValues(rows = [], pick, known = []) {
  const read =
    pick || ((row) => row?.category_type ?? row?.product_detail?.category_type ?? '');
  const seen = new Set();
  const values = [];
  const add = (candidate) => {
    const raw = String(candidate ?? '').trim();
    if (!raw || seen.has(raw)) return;
    seen.add(raw);
    values.push(raw);
  };
  SEEDED_PRODUCT_CATEGORY_TYPES.forEach(add);
  known.forEach(add);
  rows.forEach((row) => add(read(row)));
  return values;
}

/** The same list as `{ value, label }`, ready for a select. */
export function productCategoryTypeOptions(rows, t, pick, known) {
  return productCategoryTypeValues(rows, pick, known).map((value) => ({
    value,
    label: categoryTypeLabel(value, t),
  }));
}
