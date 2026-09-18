import {test,expect} from '@playwright/test';

test('undoing completion keeps actual time and updates subject progress',async({page})=>{
 await page.goto('/dashboard-v2');
 await page.getByRole('button',{name:'Edit plan',exact:true}).click();
 await page.getByRole('button',{name:'Edit: Cell structure review',exact:true}).click();
 await page.getByLabel('Status',{exact:true}).selectOption('Planned');
 await page.getByRole('button',{name:'Save block',exact:true}).click();
 await expect(page.getByTestId('progress-Biology')).toHaveAttribute('title',/25 min worked; 75 min planned. 33% covered/);
 await expect(page.getByRole('button',{name:'Edit: Calculus lecture',exact:true})).toHaveCount(0);
});

test('gap editor updates schedule, priorities, progress, and proposal availability',async({page})=>{
 await page.goto('/dashboard-v2');
 await page.getByRole('button',{name:'Edit plan',exact:true}).click();
 await page.getByRole('button',{name:'Add block in gap 11:00 AM–1:00 PM',exact:true}).click();
 await expect(page.getByLabel('Start time',{exact:true})).toHaveValue('11:00');
 await expect(page.getByLabel('End time',{exact:true})).toHaveValue('13:00');
 await page.getByLabel('Title',{exact:true}).fill('Chemistry revision');
 await page.getByLabel('Subject',{exact:true}).selectOption({label:'+ New course…'});
 await page.getByLabel('New course name',{exact:true}).fill('Chemistry');
 await page.screenshot({path:'test-results/dashboard-editor.png',fullPage:true});
 await page.getByRole('button',{name:'Save block',exact:true}).click();
 await expect(page.getByText('300 min planned across your subjects')).toBeVisible();
 await expect(page.getByTestId('progress-Chemistry')).toHaveCSS('flex-grow','120');
 await page.getByRole('button',{name:'Done editing',exact:true}).click();
 await page.getByLabel('What do you need to work on?').fill('Read history');
 await page.getByRole('button',{name:'Send to Soma',exact:true}).click();
 await expect(page.getByRole('log')).toContainText('2:00 PM–2:30 PM');
 await expect(page.getByRole('log')).toContainText('300 study minutes');
});

test('add overlapping personal commitment, edit it, validate ordering and cancel',async({page})=>{
 await page.goto('/dashboard-v2');
 await page.getByRole('button',{name:'Edit plan',exact:true}).click();
 await page.getByRole('button',{name:'+ Add block',exact:true}).click();
 await page.getByLabel('Title',{exact:true}).fill('Lunch with Alex');
 await page.getByLabel('Type',{exact:true}).selectOption('commitment');
 await page.getByLabel('Start time',{exact:true}).fill('10:15');
 await page.getByLabel('End time',{exact:true}).fill('10:00');
 await page.getByRole('button',{name:'Save block',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('End time must be later');
 await page.getByLabel('End time',{exact:true}).fill('10:45');
 await expect(page.getByText(/Overlaps Calculus lecture/)).toBeVisible();
 await page.getByRole('button',{name:'Save block',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Lunch with Alex',exact:true})).toBeVisible();
 await expect(page.getByText('180 min planned across your subjects')).toBeVisible();
 await page.getByRole('button',{name:'Edit: Lunch with Alex',exact:true}).click();
 await page.getByLabel('Title',{exact:true}).fill('Uncommitted title');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Lunch with Alex',exact:true})).toBeVisible();
});
