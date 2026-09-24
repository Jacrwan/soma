import { useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import styles from './LegalPage.module.css';
import { MONTHLY_PRICE, SEMESTER_PRICE, SEMESTER_PER_MONTH, SEMESTER_SAVINGS, TRIAL_DAYS } from '../../lib/pricing';

export type LegalType =
  | 'privacy'
  | 'terms'
  | 'billing'
  | 'refund'
  | 'data-deletion'
  | 'contact'
  | 'ai';

const UPDATED = 'September 15, 2026';

function Privacy() {
  return (
    <div className={styles.body}>
      <div className={styles.section}>
        <p>
          This Privacy Policy explains what information Soma collects, how it is used, who it is
          shared with, and your rights. By using Soma you agree to this policy.
        </p>
      </div>

      <div className={styles.divider} />

      <div className={styles.section}>
        <h2>1. Who we are</h2>
        <p>
          Soma is an independent study-productivity application. For privacy inquiries, visit our{' '}
          <Link to="/contact">Contact</Link> page.
        </p>
      </div>

      <div className={styles.section}>
        <h2>2. Information we collect</h2>
        <ul>
          <li>
            <strong>Account data</strong> — your email address and encrypted password (or Google
            account identifier) when you register via Supabase Auth.
          </li>
          <li>
            <strong>App data stored on our servers</strong> — to-dos, schedule blocks, elapsed
            study time, app settings, and AI memory entries. These are linked to your account and
            stored in Supabase.
          </li>
          <li>
            <strong>Canvas data</strong> — your assignments and due dates, fetched from your
            school's Canvas calendar feed (iCal URL). The feed URL is stored locally in your
            browser. Assignment data is sent through a Vercel serverless proxy for parsing but
            is not stored on our servers.
          </li>
          <li>
            <strong>Google account data</strong> — when you connect Google, Soma requests OAuth
            access to the following scopes:
            <ul>
              <li><strong>Google Calendar</strong> (calendar.readonly) — to display your calendar events alongside your study schedule. Soma never creates, edits, or deletes events.</li>
              <li><strong>Google Drive</strong> (drive.file) — to read the files you explicitly select via the Google Picker, and the files Soma creates for you.</li>
              <li><strong>Google Drive</strong> (drive.readonly) — to read course material you choose to import as context for AI-generated study material.</li>
              <li><strong>Google Docs</strong> (documents) — to create Google Docs containing AI-generated study materials (notes, guides, quizzes).</li>
              <li><strong>Google Slides</strong> (presentations) — to create Google Slides presentations from AI-generated content.</li>
            </ul>
            Google access and refresh tokens are stored server-side so Soma can keep your
            connection working without asking you to sign in repeatedly. They are never exposed to
            the browser and are reachable only by our serverless functions. Section 5 explains how
            Google user data is used and Section 6 explains how it is protected.
          </li>
          <li>
            <strong>AI chat messages</strong> — when you use AI features, your messages and
            relevant context (tasks, schedule blocks, Canvas assignments, and any Google Drive
            files you attach) are sent to Anthropic to generate a response. Soma does not store
            the full conversation on its servers beyond what you save as AI memory.
          </li>
          <li>
            <strong>Voice input</strong> — when you use the voice input feature, your speech
            is processed by your browser's built-in Web Speech API to convert it to text. Audio
            is not sent to Soma's servers. The resulting text is treated the same as a typed
            message.
          </li>
          <li>
            <strong>Payment data</strong> — billing and subscription data is processed by Stripe.
            Soma does not store full card numbers or payment credentials.
          </li>
        </ul>
      </div>

      <div className={styles.section}>
        <h2>3. How we use your information</h2>
        <ul>
          <li>To provide, operate, and improve the Soma service.</li>
          <li>To process subscription payments and manage your account.</li>
          <li>To send transactional emails (account confirmation, billing receipts).</li>
          <li>To provide AI-powered features by sending context to Anthropic.</li>
          <li>To respond to support and privacy requests.</li>
        </ul>
        <p>We do not sell your personal data to third parties.</p>
      </div>

      <div className={styles.section}>
        <h2>4. Third-party services</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Service</th>
                <th>Purpose</th>
                <th>Data shared</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Supabase</td>
                <td>Authentication and database</td>
                <td>Account credentials, app data</td>
              </tr>
              <tr>
                <td>Anthropic</td>
                <td>AI responses</td>
                <td>Chat messages, tasks, schedule context</td>
              </tr>
              <tr>
                <td>Google</td>
                <td>OAuth sign-in, Calendar, Drive, Docs, Slides</td>
                <td>Google account identifier, calendar events, selected Drive files, created Docs and Slides</td>
              </tr>
              <tr>
                <td>Vercel</td>
                <td>Hosting and API proxy</td>
                <td>Request data routed through serverless functions</td>
              </tr>
              <tr>
                <td>Stripe</td>
                <td>Payment processing</td>
                <td>Name, email, billing details</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Each of these providers has their own privacy policy. We encourage you to review them.
        </p>
      </div>

      <div className={styles.section}>
        <h2>5. Google user data and Limited Use</h2>
        <p>
          Soma connects to Google only after you explicitly grant permission, and only for the
          features described below. You can disconnect Google at any time in Settings, or revoke
          Soma's access from your{' '}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Account permissions page
          </a>
          .
        </p>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Scope requested</th>
                <th>Why Soma needs it</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>calendar.readonly</td>
                <td>
                  Read your existing calendar events so study blocks are placed around commitments
                  you already have. Soma never creates, edits, or deletes calendar events.
                </td>
              </tr>
              <tr>
                <td>drive.file</td>
                <td>
                  Access only the individual files you select in the Google Picker, plus files Soma
                  itself creates. Under this scope Soma cannot see any other file in your Drive.
                </td>
              </tr>
              <tr>
                <td>drive.readonly</td>
                <td>
                  Read course material you choose to import so that notes, outlines, and practice
                  questions can be generated from it.
                </td>
              </tr>
              <tr>
                <td>documents, presentations</td>
                <td>
                  Create Google Docs and Google Slides in your account when you ask Soma to save
                  generated study material.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3>Limited Use commitment</h3>
        <p>
          Soma's use and transfer of information received from Google APIs to any other app will
          adhere to the{' '}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. The use of raw or derived user data received
          from Google Workspace APIs will adhere to the Google User Data Policy, including the
          Limited Use requirements.
        </p>

        <h3>Artificial intelligence and machine learning</h3>
        <p>
          We do not use, transfer, or sell Google user data, whether raw, aggregated, or derived, to
          develop, train, improve, or personalize foundational or generalized artificial
          intelligence or machine learning models. This restriction applies to Soma and to every
          service provider we work with.
        </p>
        <p>
          When you explicitly ask Soma to generate study material from a file you selected, the
          contents of that file are sent to Anthropic's API for the sole purpose of producing the
          output you requested and returning it to you. Under Anthropic's commercial terms, inputs
          and outputs submitted through its API are not used to train Anthropic's models. Soma does
          not send Google user data to any AI provider except in response to an action you take.
        </p>

        <h3>Human access</h3>
        <p>
          No Soma employee or contractor reads your Google user data. The only exceptions are the
          narrow cases permitted by the Limited Use requirements: where we have your explicit
          consent for a specific issue, where it is necessary for security purposes such as
          investigating abuse, or where we are required to do so by law.
        </p>

        <h3>No sale or advertising</h3>
        <p>
          We do not sell Google user data, and we do not use it for advertising, ad targeting,
          profiling, or credit assessment. We do not transfer it to data brokers, information
          resellers, or any other third party except the service providers listed in Section 4 that
          are strictly necessary to operate the features you use.
        </p>
      </div>

      <div className={styles.section}>
        <h2>6. How we protect your data</h2>
        <p>
          We apply the following technical and organizational safeguards to all personal data,
          including sensitive data obtained through Google APIs:
        </p>
        <ul>
          <li>
            <strong>Encryption in transit.</strong> All traffic between your browser, Soma, and
            every third-party API is encrypted using HTTPS with TLS 1.2 or higher. Soma is served
            strictly over HTTPS.
          </li>
          <li>
            <strong>Encryption at rest.</strong> Account and application data is stored with our
            infrastructure providers (Supabase and Vercel), which encrypt stored data and backups at
            rest using AES-256.
          </li>
          <li>
            <strong>OAuth token handling.</strong> Google refresh tokens are held server-side only.
            They are never exposed to the browser, never written to local storage, and are
            accessible only to our serverless functions using a privileged key that is not present
            in client code.
          </li>
          <li>
            <strong>Access control.</strong> User data tables enforce row-level security, so a
            signed-in user can read and write only their own rows. Administrative credentials are
            restricted to server-side functions and are not shared.
          </li>
          <li>
            <strong>Least privilege on scopes.</strong> We request the narrowest Google scopes that
            support the features you enable. File access defaults to the picker-based{' '}
            <code>drive.file</code> scope so that Soma sees only the files you deliberately choose.
          </li>
          <li>
            <strong>Authentication.</strong> Accounts are authenticated through Supabase Auth.
            Passwords are salted and hashed by the provider and are never stored or visible to us in
            plain text.
          </li>
          <li>
            <strong>Segregation and minimization.</strong> We collect only the data needed to
            deliver the feature you requested, and we do not combine Google user data with data from
            other sources to build profiles.
          </li>
          <li>
            <strong>Deletion on request.</strong> Disconnecting Google removes the stored tokens.
            Deleting your account removes associated server-side data on the timeline described in
            Section 7.
          </li>
          <li>
            <strong>Incident response.</strong> If we become aware of a breach affecting your
            personal data, we will investigate promptly and notify affected users and any applicable
            regulator as required by law.
          </li>
        </ul>
        <p>
          No method of transmission or storage is completely secure, and we cannot guarantee
          absolute security. If you believe your account has been compromised, contact us
          immediately using the details on our{' '}
          <Link to="/contact">Contact page</Link>.
        </p>
      </div>

      <div className={styles.section}>
        <h2>7. Data retention</h2>
        <ul>
          <li>Account and server-side app data is retained until you delete your account.</li>
          <li>
            Local browser data (Canvas tokens, cached assignments, local preferences) is retained
            until you clear your browser storage or use the Data Deletion tool in the app.
          </li>
          <li>
            After account deletion, server-side data is removed within 30 days. Backups may
            retain data for up to 90 days.
          </li>
        </ul>
      </div>

      <div className={styles.section}>
        <h2>8. Your rights</h2>
        <p>
          Depending on where you live, you may have the following rights regarding your personal
          data:
        </p>
        <ul>
          <li>
            <strong>Access</strong> — request a copy of the personal data we hold about you.
          </li>
          <li>
            <strong>Erasure</strong> — request deletion of your account and associated data. You
            can do this directly from Settings → Delete Account, or by contacting us.
          </li>
          <li>
            <strong>Portability</strong> — request your data in a portable format.
          </li>
          <li>
            <strong>Correction</strong> — request that inaccurate data be corrected.
          </li>
          <li>
            <strong>Opt-out of AI data processing</strong> — you can stop using AI features at any
            time to prevent further data being sent to Anthropic.
          </li>
        </ul>
        <p>
          California residents have additional rights under the CCPA, including the right to know
          what personal information is collected and the right to non-discrimination for exercising
          privacy rights. We do not sell personal information.
        </p>
        <p>
          To exercise any of these rights, contact us via the{' '}
          <Link to="/contact">Contact</Link> page.
        </p>
      </div>

      <div className={styles.section}>
        <h2>9. Children</h2>
        <p>
          Soma is not directed to children under the age of 13. We do not knowingly collect
          personal information from children under 13. If you believe a child under 13 has
          provided us personal information, please contact us and we will promptly delete it.
        </p>
      </div>

      <div className={styles.section}>
        <h2>10. Cookies and local storage</h2>
        <p>
          Soma uses browser local storage to cache your settings, Canvas calendar feed data,
          Google OAuth tokens, chat sessions, creation history, and Supabase session tokens. No
          third-party advertising cookies are used.
        </p>
      </div>

      <div className={styles.section}>
        <h2>11. Changes to this policy</h2>
        <p>
          We may update this policy from time to time. If we make material changes, we will update
          the "Last updated" date and, where appropriate, notify you by email or in-app. Continued
          use of Soma after changes take effect constitutes acceptance of the revised policy.
        </p>
      </div>
    </div>
  );
}

function Terms() {
  return (
    <div className={styles.body}>
      <div className={styles.section}>
        <p>
          These Terms of Service ("Terms") govern your use of Soma. By creating an account or
          using Soma, you agree to these Terms. If you do not agree, do not use Soma.
        </p>
      </div>

      <div className={styles.divider} />

      <div className={styles.section}>
        <h2>1. Eligibility</h2>
        <p>
          You must be at least 13 years old to use Soma. By using Soma, you represent that you
          meet this requirement and that you are using only accounts and credentials you are
          authorized to access.
        </p>
      </div>

      <div className={styles.section}>
        <h2>2. Your account</h2>
        <ul>
          <li>You are responsible for keeping your credentials secure.</li>
          <li>You are responsible for all activity that occurs under your account.</li>
          <li>
            Notify us immediately via GitHub if you believe your account has been compromised.
          </li>
          <li>
            You may not share your account with others or create accounts on behalf of third
            parties without their consent.
          </li>
        </ul>
      </div>

      <div className={styles.section}>
        <h2>3. Free tier and Soma Premium</h2>
        <p>
          Soma has a free tier that provides access to day view, canvas sync, calendar, and
          insights. AI features require <strong>Soma Premium</strong>, available at{' '}
          <strong>{MONTHLY_PRICE} USD per month</strong> or <strong>{SEMESTER_PRICE} USD every 4 months</strong> ({SEMESTER_PER_MONTH}/mo).
          Soma Premium begins with a <strong>{TRIAL_DAYS}-day free trial</strong> — no charge during the trial
          period. After the trial, your subscription renews automatically on your chosen billing
          cycle until you cancel. See our{' '}
          <Link to="/billing">Billing & Subscription</Link> page for full details.
        </p>
      </div>

      <div className={styles.section}>
        <h2>4. Refunds</h2>
        <p>
          See our <Link to="/refund">Refund Policy</Link> for eligibility and how to request a
          refund.
        </p>
      </div>

      <div className={styles.section}>
        <h2>5. Price changes</h2>
        <p>
          We will give you at least 30 days' notice before any price increase, via the email
          address on your account. If you do not cancel before the price change takes effect,
          you agree to the new price.
        </p>
      </div>

      <div className={styles.section}>
        <h2>6. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Use Soma for any unlawful purpose or in violation of any applicable laws.</li>
          <li>
            Access Canvas, Google, or any other service through Soma using credentials you are
            not authorized to use.
          </li>
          <li>
            Reverse-engineer, decompile, or attempt to extract the source code of Soma (beyond
            what is publicly available on GitHub under its license).
          </li>
          <li>
            Interfere with or disrupt Soma's infrastructure, servers, or networks.
          </li>
          <li>
            Use automated means (scrapers, bots) to access or interact with Soma without
            permission.
          </li>
        </ul>
      </div>

      <div className={styles.section}>
        <h2>7. Intellectual property</h2>
        <p>
          Soma and its original content, features, and design are owned by or licensed to the
          Soma project. Your data — tasks, schedules, notes — remains yours. You grant Soma a
          limited license to store and process your data solely for the purpose of providing the
          service.
        </p>
      </div>

      <div className={styles.section}>
        <h2>8. Third-party services</h2>
        <p>
          Soma integrates with Canvas (via iCal feeds), Google (Calendar, Drive, Docs, Slides),
          Anthropic (AI), Supabase, Vercel, and Stripe. Use of those services is subject to their
          own terms. Soma is not responsible for the availability, accuracy, or actions of
          third-party services.
        </p>
        <p>
          Soma's use and transfer of information received from Google APIs to any other app will
          adhere to the{' '}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. The use of raw or derived user data received
          from Google Workspace APIs will adhere to the Google User Data Policy, including the
          Limited Use requirements. We do not use Google user data to train or improve generalized
          or foundational AI or machine learning models. See Section 5 of our{' '}
          <Link to="/privacy">Privacy Policy</Link> for full details.
        </p>
      </div>

      <div className={styles.section}>
        <h2>9. Disclaimer of warranties</h2>
        <div className={styles.highlight}>
          Soma is provided "as is" and "as available" without warranties of any kind, either
          express or implied, including but not limited to warranties of merchantability, fitness
          for a particular purpose, or non-infringement. Soma does not warrant that the service
          will be uninterrupted, error-free, or that AI-generated content will be accurate,
          complete, or current. You are solely responsible for verifying academic deadlines,
          grades, and requirements in your school's official systems.
        </div>
      </div>

      <div className={styles.section}>
        <h2>10. Limitation of liability</h2>
        <div className={styles.highlight}>
          To the maximum extent permitted by applicable law, Soma and its owners, contributors,
          and service providers shall not be liable for any indirect, incidental, special,
          consequential, or punitive damages — including but not limited to missed academic
          deadlines, lost data, or reliance on AI-generated output — even if advised of the
          possibility of such damages. In no event shall Soma's total liability to you for all
          claims exceed the greater of (a) the amount you paid to Soma in the 12 months preceding
          the claim, or (b) $10 USD.
        </div>
      </div>

      <div className={styles.section}>
        <h2>11. Indemnification</h2>
        <p>
          You agree to indemnify and hold harmless Soma and its contributors from any claims,
          damages, or expenses (including reasonable legal fees) arising from your use of the
          service, your violation of these Terms, or your violation of any third party's rights.
        </p>
      </div>

      <div className={styles.section}>
        <h2>12. Account termination</h2>
        <p>
          You may delete your account at any time from Settings → Delete Account. We reserve the
          right to suspend or terminate accounts that violate these Terms, with or without notice.
          Upon termination, your access ends and your data is deleted in accordance with our{' '}
          <Link to="/privacy">Privacy Policy</Link>.
        </p>
      </div>

      <div className={styles.section}>
        <h2>13. Changes to these Terms</h2>
        <p>
          We may update these Terms from time to time. We will notify you of material changes via
          the email on your account at least 14 days before the changes take effect. Continued use
          after that date constitutes acceptance of the revised Terms.
        </p>
      </div>

      <div className={styles.section}>
        <h2>14. Governing law</h2>
        <p>
          These Terms are governed by and construed in accordance with the laws of the State of
          California, without regard to its conflict of law provisions. Any disputes arising under
          these Terms shall be resolved in the courts of California.
        </p>
      </div>

      <div className={styles.section}>
        <h2>15. Severability</h2>
        <p>
          If any provision of these Terms is found to be unenforceable, the remaining provisions
          will remain in full force and effect.
        </p>
      </div>
    </div>
  );
}

function Billing() {
  return (
    <div className={styles.body}>
      <div className={styles.section}>
        <p>
          Everything you need to know about how Soma billing works, what you're charged for, and
          how to manage your subscription.
        </p>
      </div>

      <div className={styles.divider} />

      <div className={styles.section}>
        <h2>Free tier and Soma Premium</h2>
        <p>
          Soma has a <strong>free tier</strong> that includes day view, canvas sync, calendar
          integration, insights, and manual todos and scheduling. <strong>AI features</strong>{' '}
          (AI chat, schedule generation, and todo generation) require <strong>Soma Premium</strong>.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Plan</th>
                <th>Price</th>
                <th>Equivalent</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Monthly</td>
                <td>{MONTHLY_PRICE} / month</td>
                <td>—</td>
              </tr>
              <tr>
                <td>4 months</td>
                <td>{SEMESTER_PRICE} / 4 months</td>
                <td>{SEMESTER_PER_MONTH} / month (save {SEMESTER_SAVINGS})</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.section}>
        <h2>Free trial</h2>
        <p>
          Soma Premium begins with a <strong>{TRIAL_DAYS}-day free trial</strong>. You will not be charged
          during the trial period. A valid payment method is required to start the trial. If you
          cancel before the trial ends, you will not be charged. Otherwise your first payment is
          taken automatically when the trial ends. Each account is eligible for one free trial.
        </p>
      </div>

      <div className={styles.section}>
        <h2>Billing cycle and auto-renewal</h2>
        <p>
          Your subscription begins on the day your free trial ends and renews automatically at
          the end of each billing period — monthly or every 4 months,
          depending on the plan you chose at checkout. You will be charged to the payment method
          on file at the start of each renewal period.
        </p>
      </div>

      <div className={styles.section}>
        <h2>How to cancel</h2>
        <p>
          You can cancel your subscription at any time from <strong>Settings → Subscription</strong>{' '}
          in the app. Cancellation takes effect at the end of your current billing period — you
          keep AI access until then. No partial refunds are issued for unused time in a billing
          period unless you qualify under our <Link to="/refund">Refund Policy</Link>.
        </p>
      </div>

      <div className={styles.section}>
        <h2>What happens when you cancel</h2>
        <ul>
          <li>Your access to AI features continues until the end of the paid period.</li>
          <li>
            After that, your account reverts to the free tier. Your data (todos, schedule, settings)
            is fully retained — you keep access to all free features.
          </li>
          <li>You can resubscribe at any time to restore AI access.</li>
        </ul>
      </div>

      <div className={styles.section}>
        <h2>Failed payments</h2>
        <ul>
          <li>If a payment fails, Stripe will automatically retry up to 3 times over 7 days.</li>
          <li>
            You will receive an email notification asking you to update your payment method.
          </li>
          <li>
            If payment is not resolved within 7 days, your subscription is paused and access is
            suspended until payment is resolved.
          </li>
        </ul>
      </div>

      <div className={styles.section}>
        <h2>Price changes</h2>
        <p>
          If we change the subscription price, we will notify you by email at least 30 days in
          advance. You can cancel before the new price takes effect if you do not wish to continue
          at the new rate.
        </p>
      </div>

      <div className={styles.section}>
        <h2>Taxes</h2>
        <p>
          Prices are shown exclusive of applicable taxes. Depending on your location, sales tax
          or VAT may be added at checkout. Stripe calculates and collects applicable tax
          automatically.
        </p>
      </div>

      <div className={styles.section}>
        <h2>Payment processor</h2>
        <p>
          Payments are processed by <strong>Stripe</strong>. Soma does not store your card
          number, CVV, or full billing details. Stripe's privacy policy governs how your payment
          data is handled.
        </p>
      </div>
    </div>
  );
}

function Refund() {
  return (
    <div className={styles.body}>
      <div className={styles.section}>
        <p>
          We want you to feel confident trying Soma. This policy explains when and how refunds are
          issued.
        </p>
      </div>

      <div className={styles.divider} />

      <div className={styles.section}>
        <h2>7-day refund for new subscribers</h2>
        <p>
          If you subscribe and decide Soma isn't right for you, you can request a full refund
          within <strong>7 days of your first payment</strong>. This applies to your first
          subscription payment only.
        </p>
      </div>

      <div className={styles.section}>
        <h2>How to request a refund</h2>
        <p>
          Contact us via the <Link to="/contact">Contact</Link> page with the subject "Refund
          Request" and include the email address on your account and the date of the charge. We
          will process eligible refunds within 5 business days.
        </p>
      </div>

      <div className={styles.section}>
        <h2>Renewals</h2>
        <p>
          Refunds are not issued for subsequent billing renewals (monthly or 4-month). If you no
          longer want to be charged, cancel your subscription before your next billing date from{' '}
          <strong>Settings → Subscription</strong>.
        </p>
      </div>

      <div className={styles.section}>
        <h2>Exceptions</h2>
        <p>
          If you were charged due to a technical error on our end (e.g., you were billed after
          cancelling), contact us and we will make it right regardless of the 7-day window.
        </p>
      </div>

      <div className={styles.section}>
        <h2>Chargebacks</h2>
        <p>
          We encourage you to contact us before filing a chargeback with your bank. Filing a
          chargeback without contacting us first may result in immediate account suspension while
          the dispute is resolved.
        </p>
      </div>
    </div>
  );
}

function DataDeletion() {
  return (
    <div className={styles.body}>
      <div className={styles.section}>
        <p>
          You can remove your data from Soma at any time. There are two types of data: local data
          stored in your browser, and server-side data stored in our database.
        </p>
      </div>

      <div className={styles.divider} />

      <div className={styles.section}>
        <h2>Delete local browser data</h2>
        <p>
          Go to <strong>Settings → Clear local Soma data</strong>. This removes:
        </p>
        <ul>
          <li>Cached Canvas assignments, grades, and announcements</li>
          <li>Cached Google Calendar events</li>
          <li>Canvas and Google access tokens stored in this browser</li>
          <li>Local app preferences and theme settings</li>
        </ul>
        <p>This action only affects the current browser and cannot be undone.</p>
      </div>

      <div className={styles.section}>
        <h2>Delete your account and server-side data</h2>
        <p>
          Go to <strong>Settings → Delete Account</strong>. This permanently deletes:
        </p>
        <ul>
          <li>Your Soma account (email, authentication credentials)</li>
          <li>All to-dos, schedule blocks, and elapsed time records</li>
          <li>App settings and preferences stored on our servers</li>
          <li>AI memory entries</li>
        </ul>
        <p>
          Deletion is processed immediately. Server-side records are removed within 30 days.
          Database backups may retain data for up to 90 days before they are overwritten.
        </p>
      </div>

      <div className={styles.section}>
        <h2>What is not deleted</h2>
        <p>
          Deleting your Soma account does not remove your data from Canvas, Google, your school,
          or Stripe. To revoke Soma's access to Google Calendar, Drive, Docs, and Slides, visit
          your{' '}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google account permissions
          </a>{' '}
          and remove Soma. Canvas calendar feeds do not require revocation — simply disconnect
          the feed URL in Soma's settings.
        </p>
      </div>

      <div className={styles.section}>
        <h2>Request deletion by contact</h2>
        <p>
          If you cannot access the app to delete your account, contact us via the{' '}
          <Link to="/contact">Contact</Link> page with your account email address. We will process
          the request within 30 days.
        </p>
      </div>
    </div>
  );
}

function Contact() {
  return (
    <div className={styles.body}>
      <div className={styles.section}>
        <p>For any questions, support requests, or feedback, reach us at:</p>
        <p><a href="mailto:somastudyapp@gmail.com">somastudyapp@gmail.com</a></p>
      </div>
    </div>
  );
}

function AiDisclaimer() {
  return (
    <div className={styles.body}>
      <div className={styles.section}>
        <p>
          Soma's AI features are powered by <strong>Anthropic's Claude</strong>. This page
          explains what data is sent to Anthropic and the limitations of AI-generated content.
        </p>
      </div>

      <div className={styles.divider} />

      <div className={styles.section}>
        <h2>What data is sent to Anthropic</h2>
        <p>When you use the AI tab, Soma may include the following as context:</p>
        <ul>
          <li>Your chat messages (typed or transcribed from voice input)</li>
          <li>Your schedule blocks and tasks</li>
          <li>Canvas assignments, due dates, and announcements</li>
          <li>Google Drive file contents that you explicitly attach to a chat</li>
          <li>Your availability settings (school, work, and personal hours)</li>
        </ul>
        <p>
          This context is sent to Anthropic's API to generate a response. Anthropic's use of this
          data is governed by{' '}
          <a href="https://www.anthropic.com/privacy" target="_blank" rel="noopener noreferrer">
            Anthropic's Privacy Policy
          </a>
          .
        </p>
      </div>

      <div className={styles.section}>
        <h2>Limitations of AI output</h2>
        <div className={styles.highlight}>
          AI-generated content may be inaccurate, incomplete, or outdated. Do not rely on Soma's
          AI as the sole source for academic deadlines, grades, assignment requirements, or
          official school communications. Always verify critical information in Canvas, Google
          Calendar, or your school's official systems.
        </div>
      </div>

      <div className={styles.section}>
        <h2>Opting out</h2>
        <p>
          AI features are optional. If you prefer not to send data to Anthropic, simply do not
          use the AI tab. All other Soma features function without it.
        </p>
      </div>

      <div className={styles.section}>
        <h2>Voice input</h2>
        <p>
          When you use voice input, your speech is converted to text by your browser's built-in
          Web Speech API. The audio is processed locally by your browser and is not sent to Soma
          or Anthropic. Only the resulting text transcription is sent to Anthropic as part of your
          chat message. AI responses may be read aloud using your browser's built-in
          text-to-speech — this also runs locally with no data sent externally.
        </p>
      </div>

      <div className={styles.section}>
        <h2>Google Drive files</h2>
        <p>
          When you attach a Google Drive file to a chat, its contents are read via the Google
          Docs or Drive API and included in the message sent to Anthropic. Only files you
          explicitly select via the Google Picker are accessed — Soma cannot browse your Drive.
          Soma may also create Google Docs and Slides on your behalf when generating study
          materials.
        </p>
      </div>

      <div className={styles.section}>
        <h2>AI model</h2>
        <p>
          Soma uses Claude Sonnet and Claude Haiku via the Anthropic API, depending on the
          task. The models may change as newer versions become available.
        </p>
      </div>
    </div>
  );
}

const CONFIG: Record<
  LegalType,
  { title: string; component: () => ReactElement }
> = {
  privacy:       { title: 'Privacy Policy',          component: Privacy       },
  terms:         { title: 'Terms of Service',         component: Terms         },
  billing:       { title: 'Billing & Subscription',   component: Billing       },
  refund:        { title: 'Refund Policy',            component: Refund        },
  'data-deletion': { title: 'Data Deletion',          component: DataDeletion  },
  contact:       { title: 'Contact',                  component: Contact       },
  ai:            { title: 'AI Disclaimer',            component: AiDisclaimer  },
};

export default function LegalPage({ type }: { type: LegalType }) {
  const config = CONFIG[type];
  const [backTo, setBackTo] = useState('/');

  useEffect(() => {
    const prev = document.title;
    document.title = `${config.title} | Soma`;
    return () => { document.title = prev; };
  }, [config.title]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setBackTo('/dashboard');
    });
  }, []);

  const Content = config.component;

  return (
    <div className={styles.wrap}>
      <div className={styles.topbar}>
        <Link to={backTo} className={styles.wordmark}>Soma</Link>
        <Link to={backTo} className={styles.back}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 2L4 7l5 5" />
          </svg>
          Back
        </Link>
      </div>
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.title}>{config.title}</h1>
          <p className={styles.updated}>Last updated: {UPDATED}</p>
        </div>
        <Content />
      </div>
    </div>
  );
}
