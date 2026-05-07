export const metadata = { title: "Zoom Integration Guide — ABA Scheduler" };

export default function ZoomGuidePage() {
  return (
    <>
      <h1>Zoom Integration Guide</h1>
      <p>
        This page documents how to install, use, and remove the ABA Scheduler Zoom application. The integration enables two-way Zoom Chat between practice administrators and field staff.
      </p>

      <h2>1. Installing the App</h2>
      <ol>
        <li>Open the authorization URL provided by your administrator (this is the Account-only install link generated from the Zoom Marketplace listing).</li>
        <li>Sign in to Zoom with your work account when prompted.</li>
        <li>Review the requested permissions and click <strong>Authorize</strong>.</li>
        <li>You will be redirected back to the ABA Scheduler application. Installation is complete.</li>
      </ol>

      <h2>2. Using the App</h2>
      <h3>Sending a message to the bot (staff)</h3>
      <ol>
        <li>Open the Zoom Desktop or Mobile client.</li>
        <li>In the Chat tab, search for &quot;ABA Scheduler&quot; and start a direct message.</li>
        <li>Type your message and send. Examples: &quot;Cancelling my 9am with Davis,&quot; or &quot;What time is my Tuesday session?&quot;</li>
        <li>Your message is delivered to the practice&apos;s admin inbox. An administrator will reply, and the reply will appear back in your Zoom DM thread with the bot.</li>
      </ol>

      <h3>Replying to a message (administrators)</h3>
      <ol>
        <li>Sign in to the ABA Scheduler at <a href="/">the application home page</a>.</li>
        <li>Open the <strong>Communications</strong> inbox in the left navigation.</li>
        <li>Click on the thread to view the message history.</li>
        <li>Type your reply in the text box and click <strong>Send</strong>. The reply is delivered to the staff member as a Zoom Chat message from the bot.</li>
      </ol>

      <h2>3. What the Application Accesses</h2>
      <p>The integration accesses only the following data from Zoom:</p>
      <ul>
        <li>The text of direct messages sent <em>to</em> the ABA Scheduler bot.</li>
        <li>The Zoom user ID and display name of the sender of those messages.</li>
        <li>User lookup by email address, used to resolve a recipient when sending a reply.</li>
      </ul>
      <p>The application does <strong>not</strong> access:</p>
      <ul>
        <li>Zoom meetings, recordings, or transcripts</li>
        <li>Calendar events</li>
        <li>Channel messages or group chats</li>
        <li>Direct messages between users that do not involve the bot</li>
      </ul>

      <h2>4. Removing the App</h2>
      <ol>
        <li>Sign in to the Zoom App Marketplace at <a href="https://marketplace.zoom.us">marketplace.zoom.us</a>.</li>
        <li>Click <strong>Manage</strong> in the top navigation.</li>
        <li>Find &quot;ABA Scheduler&quot; (or &quot;Scheduling Messenger&quot;) under <strong>Installed Apps</strong>.</li>
        <li>Click <strong>Remove</strong>. Zoom will revoke the app&apos;s access and stop sending webhook events.</li>
      </ol>
      <p>Account administrators can also remove the app for the entire account from the Zoom admin panel under <strong>Advanced &gt; App Marketplace &gt; Manage Installed Apps</strong>.</p>

      <h2>5. Data Removal Upon Uninstall</h2>
      <p>
        When the app is uninstalled, Zoom will stop sending webhook events. Existing message history previously stored in the ABA Scheduler database remains for the practice&apos;s recordkeeping purposes. To request deletion of your historical message data, contact <a href="mailto:alltogetherautismadmin@gmail.com">alltogetherautismadmin@gmail.com</a> and reference our <a href="/legal/privacy">Privacy Policy</a>, Section 6 (Your Rights).
      </p>

      <h2>6. Troubleshooting</h2>
      <ul>
        <li><strong>I can&apos;t find the bot in Zoom search:</strong> ensure the app is installed for your account. Contact your administrator.</li>
        <li><strong>My message isn&apos;t getting a reply:</strong> the admin team typically responds within 1 business day. Urgent issues should go through the practice&apos;s primary phone line.</li>
        <li><strong>Other issues:</strong> see the <a href="/legal/support">Support page</a>.</li>
      </ul>
    </>
  );
}
