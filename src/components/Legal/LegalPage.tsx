import { useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import styles from './LegalPage.module.css';

export type LegalType =
  | 'privacy'
  | 'terms'
  | 'billing'
  | 'refund'
  | 'data-deletion'
  | 'contact'
  | 'ai';

const UPDATED = 'May 26, 2026';

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
            <strong>Canvas data</strong> — your Canvas access token, course list, assignments,
            grades, and announcements. This data is fetched from your school's Canvas instance and
            cached locally in your browser. Canvas tokens are sent through a Vercel serverless
            function acting as a proxy; they are not stored on our servers.
          </li>
          <li>
            <strong>Google Calendar data</strong> — your Google OAuth token and calendar events,
            cached locally in your browser. We do not store Google tokens on our servers.
          </li>
          <li>
            <strong>AI chat messages</strong> — when you use AI features, your messages and
            relevant context (tasks, schedule blocks, Canvas assignments) are sent to Anthropic to
            generate a response. Soma does not store the full conversation on its servers beyond
            what you save as AI memory.
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
                <td>OAuth sign-in and Calendar data</td>
                <td>Google account identifier, calendar events</td>
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
        <h2>5. Data retention</h2>
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
        <h2>6. Your rights</h2>
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
        <h2>7. Children</h2>
        <p>
          Soma is not directed to children under the age of 13. We do not knowingly collect
          personal information from children under 13. If you believe a child under 13 has
          provided us personal information, please contact us and we will promptly delete it.
        </p>
      </div>

      <div className={styles.section}>
        <h2>8. Cookies and local storage</h2>
        <p>
          Soma uses browser local storage to cache your settings, Canvas data, Google tokens, and
          Supabase session tokens. No third-party advertising cookies are used.
        </p>
      </div>

      <div className={styles.section}>
        <h2>9. Changes to this policy</h2>
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
          <strong>$5.99 USD per month</strong> or <strong>$47.88 USD per year</strong> ($3.99/mo).
          Soma Premium begins with a <strong>30-day free trial</strong> — no charge during the trial
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
          Soma integrates with Canvas, Google, Anthropic, Supabase, Vercel, and Stripe. Use of
          those services is subject to their own terms. Soma is not responsible for the
          availability, accuracy, or actions of third-party services.
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
                <td>$5.99 / month</td>
                <td>—</td>
              </tr>
              <tr>
                <td>Annual</td>
                <td>$47.88 / year</td>
                <td>$3.99 / month (save 33%)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.section}>
        <h2>Free trial</h2>
        <p>
          Soma Premium begins with a <strong>30-day free trial</strong>. You will not be charged
          during the trial period. A valid payment method is required to start the trial. If you
          cancel before the trial ends, you will not be charged. Each account is eligible for one
          free trial.
        </p>
      </div>

      <div className={styles.section}>
        <h2>Billing cycle and auto-renewal</h2>
        <p>
          Your subscription begins on the day your free trial ends and renews automatically at
          the end of each billing period — monthly (every 30 days) or annually (every 365 days),
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
          Refunds are not issued for subsequent billing renewals (monthly or annual). If you no
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
          or Stripe. To revoke Soma's access to Google Calendar, visit your{' '}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google account permissions
          </a>
          . To revoke Canvas access, remove the token in Canvas.
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
        <p>Contact information coming soon.</p>
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
          <li>Your chat messages</li>
          <li>Your schedule blocks and tasks</li>
          <li>Canvas assignments, due dates, and announcements</li>
          <li>AI memory entries you have saved</li>
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
        <h2>AI model</h2>
        <p>
          Soma currently uses Claude Haiku via the Anthropic API. The model may change as newer
          versions become available.
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
    document.title = `Soma — ${config.title}`;
    return () => { document.title = prev; };
  }, [config.title]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setBackTo('/day-view');
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
