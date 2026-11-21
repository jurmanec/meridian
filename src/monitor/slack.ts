export type SlackMessage = {
  webhookUrl: string;
  text: string;
};

export type SlackSender = (message: SlackMessage) => Promise<void>;

export async function postSlack(message: SlackMessage): Promise<void> {
  let response: Response;
  try {
    response = await fetch(message.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: message.text }),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Slack request failed";
    throw new Error(detail.split(message.webhookUrl).join("[redacted]"));
  }
  if (!response.ok) {
    throw new Error(`Slack returned ${response.status}`);
  }
}
