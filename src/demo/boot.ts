import { installMockApi } from './mockApi';
import { canvasAssignments, demoSettings } from './seed';

/** Runs before the app renders: fake API routes and the demo's device cache. */
export function bootDemo() {
  installMockApi();
  const assignments = canvasAssignments();
  localStorage.setItem('soma_settings', JSON.stringify(demoSettings()));
  localStorage.setItem('soma_ical_assignments', JSON.stringify(assignments));
  localStorage.setItem('soma_canvas_cache', JSON.stringify(assignments));
  localStorage.setItem('soma_canvas_cache_timestamp', JSON.stringify(Date.now()));
  localStorage.setItem('canvas_assignment_status', JSON.stringify(
    Object.fromEntries(assignments.map(a => [a.id, a.status])),
  ));
}
