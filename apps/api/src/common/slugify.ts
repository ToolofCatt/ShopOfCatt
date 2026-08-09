/**
 * Slugify tieng Viet: d -> d, bo dau (NFD), chu thuong, ky tu khac -> "-".
 */
export function slugify(input: string): string {
  return input
    .replace(/\u0111/g, 'd')
    .replace(/\u0110/g, 'D')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
