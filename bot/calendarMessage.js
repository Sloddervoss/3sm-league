// Only a definitive Discord Unknown Message on a fresh read permits replacement.
export function createCalendarMessageUpdater({ loadConfig, saveConfig, fetchChannel, buildEmbed }) {
  let inFlight;
  let pending;

  async function update() {
    const config = loadConfig();
    const channelId = config.kalender_channel_id;
    if (!channelId) return;
    const channel = await fetchChannel(channelId);
    if (!channel) return;
    const messageId = pending?.channelId === channelId ? pending.messageId : config.kalender_message_id;
    const embed = await buildEmbed();

    if (messageId) {
      let message;
      try {
        message = await channel.messages.fetch({ message: messageId, force: true, cache: false });
      } catch (error) {
        if (error?.status !== 404 || error?.code !== 10008) throw error;
      }
      if (message) {
        await message.edit({ embeds: [embed] });
        if (pending?.messageId === messageId) {
          saveConfig({ kalender_message_id: messageId });
          pending = undefined;
        }
        return;
      }
    }

    const message = await channel.send({ embeds: [embed] });
    pending = { channelId, messageId: message.id };
    saveConfig({ kalender_message_id: message.id });
    pending = undefined;
  }

  return function updateCalendarEmbed() {
    if (!inFlight) inFlight = update().finally(() => { inFlight = undefined; });
    return inFlight;
  };
}
