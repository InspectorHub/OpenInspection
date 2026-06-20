export function formatRelativeTime(epochSec: number): string {
 const diffDays = Math.floor((Date.now() / 1000 - epochSec) / 86400);
 if (diffDays <= 0) return 'today';
 if (diffDays === 1) return '1 day ago';
 if (diffDays < 7)   return `${diffDays} days ago`;
 if (diffDays < 30)  return `${Math.floor(diffDays / 7)} wk ago`;
 return `${Math.floor(diffDays / 30)} mo ago`;
}
