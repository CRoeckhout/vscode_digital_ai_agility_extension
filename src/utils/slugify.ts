/**
 * String utilities for branch name generation and text processing.
 */

/**
 * Converts a string to a URL/branch-safe slug.
 * - Converts to lowercase
 * - Removes content in brackets
 * - Removes leading ticket identifiers (S-12345, D-12345, etc.)
 * - Replaces non-alphanumeric characters with underscores
 * - Removes leading/trailing underscores
 * - Collapses multiple underscores
 */
export function slugify(input: string): string {
  let result = input.toLowerCase();

  // Remove anything in brackets
  result = result.replace(/\[.*?\]/g, '');

  // Remove leading ticket identifiers like S-12345, D-12345, s_12345, d_12345
  result = result.replace(/^([sd][-_\s]?\d+\b)[:\-\s_]*/i, '');
  result = result.replace(/^(\d+\b)[:\-\s_]*/i, '');

  // Normalize to underscores
  result = result.replace(/[^a-z0-9]+/g, '_');
  result = result.replace(/^_+|_+$/g, '');
  result = result.replace(/_+/g, '_');

  return result;
}

/**
 * Generates a git branch name from a ticket number and title.
 * Format: <ticketNumber>/<slugified_title>
 * 
 * @param ticketNumber The ticket number (e.g., "S-12345" or "12345")
 * @param title The ticket title to slugify
 * @returns A formatted branch name
 */
export function generateBranchName(ticketNumber: string, title?: string): string {
  // Remove any occurrences of the ticket number variants from the title
  let titleForSlug = title ?? '';
  
  if (ticketNumber) {
    const digits = ticketNumber.replace(/\D/g, '');
    if (digits) {
      // Remove variants like 'S-12345', 'D-12345', 's_12345', 'd_12345', '12345'
      const pattern = new RegExp(`([sd][-_\\s]?${digits}|${digits})`, 'ig');
      titleForSlug = titleForSlug.replace(pattern, '');
    }
  }

  const slug = titleForSlug ? slugify(titleForSlug) : 'ticket';
  return `${ticketNumber}/${slug}`;
}
