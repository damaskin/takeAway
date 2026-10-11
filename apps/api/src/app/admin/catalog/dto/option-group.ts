/** A group label typed with spaces around it is the same group; an empty one is no group («Добавки»). */
export const trimGroup = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};
