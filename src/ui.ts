export function element<T extends HTMLElement = HTMLElement>(root: ParentNode, id: string): T {
  const found = root.querySelector<T>(`#${id}`);
  if (!found) throw new Error(`Missing element: ${id}`);
  return found;
}
