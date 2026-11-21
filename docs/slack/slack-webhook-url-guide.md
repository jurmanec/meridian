# How to Get a Slack Incoming Webhook URL for a Channel

Incoming webhooks let external apps and services post messages into a Slack channel via a unique URL. Each webhook URL is tied to one specific channel.

Treat the URL like a password — anyone who has it can post messages to that channel. Slack actively searches for and revokes leaked webhook URLs.

## Option 1: Create a New Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and sign in.
2. Click **Create New App** → **From scratch**.
3. Give the app a name and select the workspace where you want the webhook to post.
4. Click **Create App**.
5. In the left sidebar, go to **Features → Incoming Webhooks**.
6. Toggle **Activate Incoming Webhooks** to **On**.
7. Scroll down and click **Add New Webhook to Workspace**.
8. Select the channel you want the webhook to post to.
   - For private channels, you must already be a member of the channel.
9. Click **Allow** / **Authorize**.
10. You’ll be returned to the Incoming Webhooks page. Copy the new URL listed under **Webhook URLs for Your Workspace**.

The URL is an HTTPS link under `hooks.slack.com` with a workspace-specific path. Treat it like a password; do not commit a real webhook URL into the repo.

## Option 2: Use an Existing Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps).
2. Select your existing app.
3. In the left sidebar, open **Features → Incoming Webhooks**.
4. If **Activate Incoming Webhooks** is off, turn it **On**.
5. Click **Add New Webhook to Workspace**.
6. Choose the desired channel, then click **Allow**.
7. Copy the new URL from the **Webhook URLs for Your Workspace** section.

You can add multiple webhooks to the same app — one per channel.

## Test Your Webhook

```bash
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"Hello from webhook!"}' \
  YOUR_WEBHOOK_URL
```

Replace `YOUR_WEBHOOK_URL` with the URL you copied. You should see the message appear in the selected Slack channel.

## Important Notes

- Each webhook is permanently tied to the channel you selected when creating it.
- To post to a different channel, create a new webhook and choose that channel.
- Do not commit webhook URLs to public repositories or share them insecurely.
- Store them in environment variables or a secrets manager.

## Official Documentation

- [Sending messages using incoming webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks)
- [Slack API Apps Dashboard](https://api.slack.com/apps)
