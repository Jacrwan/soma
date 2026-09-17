import { test, expect } from '@playwright/test';
import { overlapGroups, progressSegments } from '../src/components/DashboardV2/progress';

test('subject allocation combines tasks, completion credits only its share, and overtime expands', () => {
 const bio = {subject:'Biology',color:'green'};
 const items=[{...bio,minutes:45,actualSeconds:1500,state:'Completed'},{...bio,minutes:30,actualSeconds:0,state:'Planned'}];
 expect(progressSegments(items)[0]).toMatchObject({weight:75,planned:75,actual:25,fill:.6});
 expect(progressSegments([...items.slice(0,1),{...items[1],state:'Completed'}])[0].fill).toBe(1);
 expect(progressSegments([{...items[0],actualSeconds:3600},items[1]])[0]).toMatchObject({weight:90,planned:75,fill:60/90});
 expect(progressSegments([{...bio,minutes:0,state:'Completed'},{...bio,minutes:0,state:'Planned'}])[0].fill).toBe(.5);
 expect(progressSegments([])).toEqual([]);
});

test('overlap grouping uses the furthest end and treats adjacency as nonoverlapping', () => {
 const result=overlapGroups([{time:'09:00–12:00'},{time:'09:30–10:00'},{time:'10:30–11:00'},{time:'12:00–13:00'}]);
 expect(result.map(x=>x.items.length)).toEqual([3,1]);
 expect(result[0].end).toBe(720);
});

test('concurrent blocks share two columns and early completion fills progress', async ({page})=>{
 await page.setViewportSize({width:1280,height:720});
 await page.goto('/dashboard-v2');
 const group=page.getByLabel('Overlapping commitments');
 await expect(group.locator('article')).toHaveCount(2);
 const boxes=await group.locator('article').all();
 const a=await boxes[0].boundingBox(), b=await boxes[1].boundingBox();
 expect(a!.y).toBe(b!.y);expect(b!.x).toBeGreaterThan(a!.x+a!.width);
 await expect(page.getByTestId('progress-Mathematics')).toHaveCSS('flex-grow','60');
 await page.getByRole('button',{name:'Complete: Problem set 04',exact:true}).click();
 await expect(page.getByTestId('progress-Mathematics')).toHaveAttribute('style',/--fill: 100%/);
 await expect(page.getByTestId('progress-Mathematics').locator('svg')).toHaveCount(0);
 await expect(page.getByTestId('progress-Biology')).toHaveAttribute('style',/--fill: 60%/);
 const buttons=page.getByLabel('Next seven days').getByRole('button');
 await buttons.nth(2).click();
 await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','50');
 await page.getByRole('button',{name:'Complete: Organize notes',exact:true}).click();
 await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','100');
});

test('focus time fills proportionally and is retained across separate sessions', async ({page})=>{
 await page.clock.install();
 await page.goto('/dashboard-v2');
 await page.getByRole('button',{name:'Start focus: Problem set 04',exact:true}).click();
 await page.clock.fastForward(15*60*1000);
 await expect(page.getByTestId('progress-Mathematics')).toHaveAttribute('style',/--fill: 25%/);
 await page.getByRole('button',{name:'Stop',exact:true}).click();
 await page.getByRole('button',{name:'Continue later',exact:true}).click();
 await expect(page.getByTestId('progress-Mathematics')).toHaveAttribute('style',/--fill: 25%/);
 await page.getByRole('button',{name:'Start focus: Problem set 04',exact:true}).click();
 await page.clock.fastForward(15*60*1000);
 await expect(page.getByTestId('progress-Mathematics')).toHaveAttribute('style',/--fill: 50%/);
});
