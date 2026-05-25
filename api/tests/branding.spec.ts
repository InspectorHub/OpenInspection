/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { test, expect } from '@playwright/test';

/**
 * Multi-tenant Branding & White-labeling Sequential Verification
 */
test.describe('Branding System E2E', () => {
    
    test('complete branding lifecycle: set up, verify defaults, and customize', async ({ page }) => {
        // Increase global timeout for this test
        test.setTimeout(60000);

        // 1. Initial Setup Page (Global Defaults)
        console.log('Checking /setup global defaults...');
        await page.goto('http://localhost:8789/setup');
        await expect(page).toHaveTitle(/OpenInspection/);
        await expect(page.locator('span:has-text("OpenInspection")')).toBeVisible();
        
        // 2. Perform Setup
        console.log('Performing Workspace Setup...');
        await page.fill('#companyName', 'Branding Corp');
        await page.fill('#adminEmail', 'test@example.com');
        await page.fill('#adminPassword', 'Password123!');
        
        // We'll wait for the network request to finish
        const responsePromise = page.waitForResponse(response => 
            response.url().includes('/setup') && response.request().method() === 'POST'
        );
        await page.click('#setupBtn');
        const response = await responsePromise;
        console.log(`POST /setup status: ${response.status()}`);
        
        // 3. Verify Dashboard (Still Default Branding)
        console.log('Verifying Dashboard defaults...');
        try {
            await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
        } catch (e) {
            console.error('Redirection to /dashboard failed. Current URL:', page.url());
            await page.screenshot({ path: 'setup-failure.png' });
            throw e;
        }
        await expect(page.locator('span:has-text("OpenInspection")')).toBeVisible();
        
        // 4. Update Branding in Settings
        console.log('Updating Branding in /settings...');
        await page.goto('http://localhost:8789/settings');
        await page.waitForSelector('#siteName');
        
        await page.fill('#siteName', 'NitroInspect');
        await page.fill('#primaryColor', '#ff5722'); 
        
        // --- REAL LOGO UPLOAD TEST ---
        console.log('Executing Real Logo Upload Test...');
        const filePath = 'tests/assets/test-logo.png';
        await page.setInputFiles('#logoInput', filePath);
        
        await page.click('button:has-text("Save Branding")');
        
        // Wait for KV/DB and R2 propagation
        await page.waitForTimeout(4000);
        
        // 5. Verify Propagation to Page Title and Header
        console.log('Verifying propagation to Title, Header, and Logo...');
        await page.reload(); 
        await page.waitForURL('**/settings**');
        
        await expect(page).toHaveTitle(/NitroInspect/);
        await expect(page.locator('span:has-text("NitroInspect")')).toBeVisible();
        
        // Verify logo is present in the settings navigation
        console.log('Verifying logo presence in Settings Navigation...');
        const settingsLogo = page.locator('nav img[alt="NitroInspect"]');
        await expect(settingsLogo).toBeVisible();
        const logoSrc = await settingsLogo.getAttribute('src');
        expect(logoSrc).toContain('/api/inspections/photo/branding/');
        
        // 6. Verify Propagation to Dashboard (BareLayout with Nav)
        console.log('Verifying logo presence in Dashboard Navigation...');
        await page.goto('http://localhost:8789/dashboard');
        await expect(page.locator('nav img[alt="NitroInspect"]')).toBeVisible();
        
        // 7. Verify Propagation to Public Booking Page (MainLayout with Header)
        console.log('Verifying propagation to Public Booking Page Header...');
        await page.goto('http://localhost:8789/book');
        
        // Wait for page to stabilize
        await page.waitForTimeout(2000);
        
        const currentTitle = await page.title();
        
        // Check title first - this tells us if branding context exists at all
        console.log('Checking /book title...');
        expect(currentTitle).toContain('NitroInspect');
        
        console.log('Checking /book header logo...');
        const headerLogo = page.locator('header img[alt="NitroInspect"]');
        await expect(headerLogo).toBeVisible();
        
        // 8. Verify CSS Variables & Button Color
        console.log('Verifying CSS variable injection and style effectiveness...');
        const primaryColor = await page.evaluate(() => 
            getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim()
        );
        expect(primaryColor.toLowerCase()).toBe('#ff5722');
        
        // Let's check a button on the dashboard or go back to settings to check the button there
        await page.goto('http://localhost:8789/settings');
        const btnStyles = await page.evaluate(() => {
            const btn = document.querySelector('#brandingBtn');
            if (!btn) return { bg: '', color: '' };
            const style = getComputedStyle(btn);
            return {
                bg: style.backgroundImage,
                color: style.color
            };
        });
        // Linear gradient should contain the primary color rgb(255, 87, 34)
        expect(btnStyles.bg).toContain('rgb(255, 87, 34)'); 
        
        console.log('Branding System Verification Passed Successfully!');
    });
});
