import type { CourseItem } from './courseItems';

// Existing calendar blocks keep the exam deadline that applied when they were created.
export async function legacyExamDates(userId: string, items: CourseItem[]) {
  const ids = [...new Set(items.map(i => i.examId).filter((id): id is string => !!id))];
  if (!ids.length) return [];
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.from('exam_plans').select('id,exam_date,todo_id').eq('user_id', userId).in('id', ids);
  if (error) throw new Error('Could not check the exam date for this saved block. Please retry.');
  return (data ?? []).map(row => ({ id: String(row.id), examDate: String(row.exam_date), todoId: row.todo_id as string | null }));
}

function readTitle(unit: string, range: string, part: string, original: string) {
  const verb = /\breread|\b(?:second|2nd) pass|\b(?:pass|round) 2\b/i.test(original) ? 'Reread' : 'Read';
  const prefix = unit === 'chapter' ? (range.includes('–') ? 'chapters ' : 'chapter ') : '';
  return `${verb} ${prefix}${range}${part}`;
}

// Recognize the generated suffix even when the old 40-character label cut the topic mid-word.
function sittingLabel(label: string) {
  const old = label.match(/ · (section|chapter) (\d+(?:\.\d+)?(?:–\d+(?:\.\d+)?)?)(?: \((\d+\/\d+)\))?$/i);
  return old ? readTitle(old[1], old[2], old[3] ? ` (part ${old[3]})` : '', label) : label;
}

// The stored timer title is the join key for Focus history. Shorten it only for display.
export function examBlockLabel(block: { title: string; examPlanId?: string }) {
  if (!block.examPlanId) return block.title;
  const [heading] = block.title.split(' — ');
  const label = sittingLabel(heading);
  return label === heading ? block.title : label;
}
