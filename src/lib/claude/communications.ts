import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-4-6";

export interface ClassificationResult {
  isCancellation: boolean;
  label: "CANCELLATION" | "OTHER";
  confidence: number;
  summary: string;
}

export async function classifyAndSummarizeMessage(params: {
  rawBody: string;
  senderName: string | null;
  messageType: "SMS" | "VOICEMAIL" | "ZOOM_CHAT";
}): Promise<ClassificationResult> {
  const { rawBody, senderName, messageType } = params;

  const senderLabel = senderName ?? "an unknown sender";
  const channelLabel =
    messageType === "VOICEMAIL" ? "voicemail transcript" :
    messageType === "ZOOM_CHAT" ? "Zoom Chat message" :
    "SMS message";

  const prompt = `You are reviewing an inbound ${channelLabel} from ${senderLabel} to a therapy practice.

Message content:
"""
${rawBody}
"""

Determine whether this message indicates the sender wants to cancel or skip an upcoming therapy session. This includes explicit cancellations, requests to reschedule, or notifications that they cannot attend.

Respond with a JSON object only, no other text:
{
  "isCancellation": true or false,
  "label": "CANCELLATION" or "OTHER",
  "confidence": 0.0 to 1.0,
  "summary": "1-2 sentence plain-language summary of what the message says"
}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      isCancellation: false,
      label: "OTHER",
      confidence: 0,
      summary: rawBody.slice(0, 200),
    };
  }

  const parsed = JSON.parse(jsonMatch[0]) as ClassificationResult;
  return parsed;
}

export async function draftCancellationReply(params: {
  senderName: string | null;
  summary: string;
  practiceContext?: string;
}): Promise<string> {
  const { senderName, summary, practiceContext } = params;
  const practice = practiceContext ?? process.env.PRACTICE_NAME ?? "our practice";
  const name = senderName ?? "there";

  const prompt = `You are a scheduling coordinator at ${practice}, a therapy practice. Draft a brief, warm reply acknowledging a cancellation message.

The person's name is: ${name}
What they said (summary): ${summary}

Write a 2-4 sentence reply that:
- Acknowledges the cancellation warmly
- Does NOT mention diagnoses, insurance, or clinical details
- Does NOT promise specific reschedule times (the scheduler will handle that)
- Sounds human, not robotic

Reply text only, no quotes or labels:`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    messages: [{ role: "user", content: prompt }],
  });

  return response.content[0].type === "text"
    ? response.content[0].text.trim()
    : "";
}

export interface ActionStep {
  step: number;
  action: string;
  detail: string | null;
  contactName: string | null;
  contactPhone: string | null;
}

const ACTION_STEPS_MODEL = "claude-opus-4-7";

const ACTION_STEPS_SYSTEM = `You are an AI scheduling coordinator for an ABA (Applied Behavior Analysis) therapy practice. When a provider, client, or family member sends a message, you propose a concrete checklist of next steps for the human scheduler to complete.

# About ABA scheduling

- **RBTs** (Registered Behavior Technicians) deliver direct therapy under BCBA supervision.
- **BCBAs** (Board Certified Behavior Analysts) supervise RBTs, write treatment plans, and may also deliver direct therapy.
- Each client has an **approved provider list** — only certain providers can work with that client. Replacement candidates after a cancellation must come from this list.
- Sessions occur at **HOME** or **CENTER**. The provider must be approved at the same location type as the session.
- Each client has **authorization hours per week**. The scheduler should not exceed these.
- When **anyone** cancels, the **other party must be notified**: provider cancels → notify the affected client(s); client cancels → notify the assigned provider(s).
- After processing a cancellation, **run auto-schedule** to propagate the change and surface backfill opportunities.

# Your job

You propose action steps. You do **not** take action — the human scheduler executes each step manually.

Every step must include:
- **action** — short verb-led title (≤ 8 words). Example: "Cancel today's sessions for Ashley Chen".
- **detail** — concrete specifics pulled from the context: session names, exact dates, exact times, provider names. Never vague. If the action involves "today", include the actual date provided in the user message.
- **contactName / contactPhone** — real values from the context whenever the step involves contacting someone. If the step is administrative (no contact required), set both to null. Never invent a phone number that isn't in the context.

**Always respond by calling the \`propose_action_steps\` tool.** Do not produce a free-form text answer. Be specific. Order steps so each can complete before the next. Default to 3–4 steps; fewer is fine if the message doesn't warrant action; more if the situation genuinely requires it. If no scheduler action is needed (e.g. a "thank you" or "got it"), call the tool with an empty steps array.

# Reference patterns

## Pattern 1 — RBT cancels for today (illness)
Inbound (Provider, RBT): "Hey, I'm running a fever, can't make my sessions today."
Steps:
1. Cancel today's sessions for the provider — list each session in the detail (client name + start time).
2. Notify each affected client of the cancellation — one step per client, with that client's name and phone in contactName/contactPhone.
3. Run auto-schedule to backfill the open slots and refresh the rest of the day.

## Pattern 2 — Client cancels for today
Inbound (Client/guardian): "Liam isn't feeling well, we won't be able to make today's sessions."
Steps:
1. Cancel today's sessions for the client — list each session in the detail (provider name + start time).
2. Notify each affected provider of the cancellation — one step per provider, with that provider's name and phone.
3. Run auto-schedule to surface coverage shuffles for the freed-up providers.

## Pattern 3 — Advance-notice cancellation (future date)
Inbound (Client): "I have a doctor appointment on Tuesday at 3pm, can we move my session?"
Steps:
1. Cancel the affected session — name client + provider + the exact future date and time.
2. Check approved-provider availability for that slot — list candidate providers from the approved list.
3a. If a backup is available — notify the client of the new provider (use the client's contactName/contactPhone) and notify the new provider that they've picked up coverage.
3b. If no backup is available — leave the session cancelled and notify the originally-assigned provider that their slot is now open (use the provider's contactName/contactPhone).

(Pick branch 3a or 3b based on what the context supports. If the context doesn't tell you which is the case, surface both as conditional steps so the scheduler can decide.)

# Quality bar

- Every step is a concrete physical action a scheduler can complete in under two minutes.
- Pull every name and phone number from the provided context. Never invent.
- If "today" is referenced in a step, write out the actual date from the user message.
- Each session you reference must use the actual time and provider/client name from the upcoming-sessions list — not generic phrasing like "their session".`;

const ACTION_STEPS_TOOL = {
  name: "propose_action_steps",
  description: "Return the proposed checklist of next steps for the human scheduler.",
  input_schema: {
    type: "object" as const,
    properties: {
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            step: {
              type: "integer",
              description: "1-based step number, in order of execution.",
            },
            action: {
              type: "string",
              description: "Short verb-led title, ≤ 8 words.",
            },
            detail: {
              type: ["string", "null"],
              description:
                "Specific details pulled from the context (session names, exact dates, exact times). Use null only if the action title is fully self-explanatory.",
            },
            contactName: {
              type: ["string", "null"],
              description:
                "Name of the person to contact for this step, pulled from the context. Null if no contact is required.",
            },
            contactPhone: {
              type: ["string", "null"],
              description:
                "Phone number for that contact, pulled from the context. Never invent. Null if not in the context or no contact is required.",
            },
          },
          required: ["step", "action", "detail", "contactName", "contactPhone"],
          additionalProperties: false,
        },
      },
    },
    required: ["steps"],
    additionalProperties: false,
  },
};

export async function generateActionSteps(params: {
  senderName: string;
  senderType: string;
  senderPhone: string | null;
  messageHistory: string;
  sessionContext: string;
  isCancellation: boolean;
  todayLabel?: string;
}): Promise<ActionStep[]> {
  const {
    senderName,
    senderType,
    senderPhone,
    messageHistory,
    sessionContext,
    isCancellation,
    todayLabel,
  } = params;

  const today =
    todayLabel ??
    new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date());

  const userContent = `# Today
${today}

# Sender
- Name: ${senderName}
- Type: ${senderType}
- Phone: ${senderPhone ?? "(not on file)"}

# Recent message history (oldest → newest)
${messageHistory}

# Their upcoming sessions
${sessionContext}

# Classification
${
  isCancellation
    ? "This message has been classified as a CANCELLATION. Build the checklist accordingly."
    : "This message is NOT classified as a cancellation. Only propose steps if the message genuinely requires scheduler action; otherwise return an empty steps array."
}`;

  const response = await client.messages.create({
    model: ACTION_STEPS_MODEL,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system: ACTION_STEPS_SYSTEM,
    tools: [ACTION_STEPS_TOOL],
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return [];

  const input = toolUse.input as { steps?: ActionStep[] };
  if (!input.steps || !Array.isArray(input.steps)) return [];

  return input.steps;
}

export async function draftScheduleChangeOutreach(params: {
  recipientName: string | null;
  recipientType: "CLIENT" | "PROVIDER";
  changeDescription: string;
  practiceContext?: string;
}): Promise<string> {
  const { recipientName, recipientType, changeDescription, practiceContext } =
    params;
  const practice = practiceContext ?? process.env.PRACTICE_NAME ?? "our practice";
  const name = recipientName ?? "there";
  const roleLabel =
    recipientType === "CLIENT"
      ? "a client (or their family)"
      : "a therapy provider on our team";

  const prompt = `You are a scheduling coordinator at ${practice}, a therapy practice. Draft a brief outreach message to notify ${roleLabel} of a schedule change.

Their name is: ${name}
Change: ${changeDescription}

Write a 2-4 sentence message that:
- Informs them of the schedule change clearly
- Is warm and professional
- Does NOT mention diagnoses, insurance, authorization numbers, or clinical details
- Sounds human, not robotic

Message text only, no quotes or labels:`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    messages: [{ role: "user", content: prompt }],
  });

  return response.content[0].type === "text"
    ? response.content[0].text.trim()
    : "";
}
