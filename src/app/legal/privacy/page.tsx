export const metadata = { title: "Privacy Policy — ABA Scheduler" };

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p><strong>Last updated:</strong> May 11, 2026</p>

      <p>
        The ABA Scheduler (&quot;the Application&quot;) is an internal scheduling tool operated by All Together Autism (&quot;we&quot;, &quot;us&quot;) for use by our internal administrative staff only. This Privacy Policy explains what information the Application collects, how it is used, how it is protected, and the rights you have over your personal information.
      </p>

      <h2>1. Information We Collect</h2>
      <ul>
        <li><strong>Staff identifiers:</strong> name, email address, role, phone number — entered by administrators when creating provider records.</li>
        <li><strong>Client identifiers:</strong> name, date of birth, address, parent/guardian contact, insurance and authorization details — entered by administrators when creating client records.</li>
        <li><strong>Schedule data:</strong> session times, locations, provider assignments, cancellations, and notes.</li>
        <li><strong>Zoom Chat data:</strong> when a staff member direct-messages the ABA Scheduler bot inside Zoom, we receive and store the message text, the staff member&apos;s Zoom user ID, the staff member&apos;s display name, and a timestamp. We do not access Zoom meetings, recordings, calendar events, or any data outside of direct messages sent to the bot.</li>
        <li><strong>Authentication data:</strong> email and securely-hashed password (managed by Supabase Auth).</li>
      </ul>

      <h2>2. How We Use the Information</h2>
      <p>Information is used solely to operate the scheduling and communication functions of the Application. Specifically:</p>
      <ul>
        <li>Match clients to qualified providers based on availability, authorization, and clinical requirements.</li>
        <li>Render schedules and send notifications to staff.</li>
        <li>Receive and reply to direct messages from staff via Zoom Chat.</li>
        <li>Generate internal reports for the practice&apos;s administrators.</li>
      </ul>

      <h2>3. How We Protect the Information</h2>
      <ul>
        <li>Data at rest is stored in a PostgreSQL database hosted on Supabase, encrypted using AES-256.</li>
        <li>Data in transit is encrypted via TLS 1.2 or higher.</li>
        <li>Access to the Application is restricted to authenticated administrators with valid credentials.</li>
        <li>Incoming webhook payloads from Zoom are verified via HMAC-SHA256 signature before processing.</li>
        <li>Zoom OAuth tokens are not persisted; they exist only as transient in-memory cache and are re-fetched as needed.</li>
      </ul>

      <h2>4. Sharing</h2>
      <p>We do not sell, rent, or share personal information with third parties for marketing purposes. Personal information is shared only with:</p>
      <ul>
        <li>Service providers strictly necessary to operate the Application: Supabase (database and authentication), Netlify (application hosting), Anthropic (Claude API for classifying and summarizing inbound chat messages; operated under zero-retention terms — content is not stored by Anthropic and is not used to train models), Google Maps (drive-time lookups for scheduling), and Zoom (chat and phone).</li>
        <li>Legal authorities when required by law.</li>
      </ul>

      <h2>5. Retention</h2>
      <p>We retain personal information for as long as necessary to operate the Application or as required by applicable healthcare recordkeeping regulations. Records may be deleted upon written request, subject to those regulations.</p>

      <h2>6. Your Rights</h2>
      <p>Depending on your jurisdiction, you may have the following rights with respect to your personal information:</p>
      <ul>
        <li><strong>Right to access</strong> — request a copy of the personal information we hold about you.</li>
        <li><strong>Right to rectification</strong> — request correction of inaccurate information.</li>
        <li><strong>Right to erasure</strong> — request deletion of your information, subject to applicable retention laws.</li>
        <li><strong>Right to restrict processing</strong> — request that we limit how we use your information.</li>
        <li><strong>Right to data portability</strong> — request a machine-readable copy of your information.</li>
        <li><strong>Right to object</strong> — object to processing in certain circumstances.</li>
        <li><strong>Right to withdraw consent</strong> — withdraw any consent previously given.</li>
      </ul>
      <p>
        To exercise any of these rights, contact us at the email address listed in Section 8. We will respond within 30 days.
      </p>

      <h2>7. Children&apos;s Privacy</h2>
      <p>The Application stores client records that may include minors receiving therapy services. All such records are managed exclusively by authorized administrators of the practice and are subject to the same protections described above, plus any additional protections required by HIPAA and other applicable healthcare laws.</p>

      <h2>8. Contact</h2>
      <p>For questions about this Privacy Policy or to exercise your data rights, contact:</p>
      <p>
        <strong>All Together Autism</strong><br />
        Email: <a href="mailto:alltogetherautismadmin@gmail.com">alltogetherautismadmin@gmail.com</a>
      </p>

      <h2>9. Changes</h2>
      <p>We may update this Privacy Policy from time to time. The &quot;Last updated&quot; date at the top will reflect the most recent revision.</p>
    </>
  );
}
