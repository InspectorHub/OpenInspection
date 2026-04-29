import type { RatingLevel } from '../../lib/report-utils';

interface RatingButtonsProps {
  itemId: string;
  levels: RatingLevel[];
  /** Alpine.js model path for current rating value, e.g. "results[itemId].rating" */
  modelPath: string;
  /** Size variant */
  size?: 'sm' | 'md';
}

export function RatingButtons({ itemId, levels, modelPath, size = 'md' }: RatingButtonsProps): JSX.Element {
  const btnSize = size === 'sm' ? 'px-2.5 py-1 text-[10px]' : 'px-3.5 py-1.5 text-xs';

  const effectiveLevels = levels.length > 0 ? levels : [
    { id: 'Satisfactory', label: 'Satisfactory', abbreviation: 'SAT', color: '#22c55e', severity: 'good' as const, isDefect: false },
    { id: 'Monitor', label: 'Monitor', abbreviation: 'MON', color: '#f59e0b', severity: 'marginal' as const, isDefect: false },
    { id: 'Defect', label: 'Defect', abbreviation: 'DEF', color: '#f43f5e', severity: 'significant' as const, isDefect: true },
    { id: 'Not Inspected', label: 'Not Inspected', abbreviation: 'N/I', color: '#3b82f6', severity: 'minor' as const, isDefect: false },
  ];

  return (
    <div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`Rating for item ${itemId}`}>
      {effectiveLevels.map((level) => (
        <button
          type="button"
          x-on:click={`setRating('${itemId}', '${level.id}')`}
          class={`${btnSize} font-semibold rounded-lg border transition-all duration-150 cursor-pointer`}
          x-bind:class={`${modelPath} === '${level.id}' ? 'text-white border-transparent shadow-sm' : 'border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-600'`}
          x-bind:style={`${modelPath} === '${level.id}' ? 'background:${level.color}' : ''`}
          aria-label={level.label}
        >
          {level.abbreviation}
        </button>
      ))}
    </div>
  );
}
