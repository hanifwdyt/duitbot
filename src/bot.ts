import { Bot, InlineKeyboard, Keyboard } from "grammy";
import { PrismaClient } from "@prisma/client";
import { parseExpense, parseReceipt, getCredits } from "./ai.js";
import {
  format,
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
} from "date-fns";
import { id } from "date-fns/locale";

const prisma = new PrismaClient();

const CAT_EMOJI: Record<string, string> = {
  food: "🍔", coffee: "☕", transport: "🚗", shopping: "🛍",
  entertainment: "🎮", bills: "📄", health: "💊", groceries: "🥬",
  snack: "🍿", drink: "🥤", other: "💸"
};

const MOOD_EMOJI: Record<string, string> = {
  happy: "😊", satisfied: "😌", excited: "🤩", neutral: "😐",
  reluctant: "😕", regret: "😔", guilty: "😣"
};

const fmt = (n: number) => "Rp" + n.toLocaleString("id-ID");
const getEmoji = (cat: string) => CAT_EMOJI[cat.toLowerCase()] || "💸";
const getMood = (mood: string | null) => mood ? MOOD_EMOJI[mood.toLowerCase()] || "" : "";

const mainKeyboard = new Keyboard()
  .text("📅 Today").text("📊 Week").text("📊 Month").row()
  .text("📝 Recent").text("↩️ Undo")
  .resized()
  .persistent();

const BUTTON_COMMANDS: Record<string, string> = {
  "📅 Today": "/today",
  "📊 Week": "/week",
  "📊 Month": "/month",
  "📝 Recent": "/recent",
  "↩️ Undo": "/undo",
};

export function createBot(token: string) {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    const name = ctx.from?.first_name || "there";
    const webUrl = process.env.WEB_URL || "https://aturuang.hanif.app";

    const dashboardKb = new InlineKeyboard().webApp("📊 Buka Dashboard", webUrl);
    await ctx.reply(
      `Yo ${name}! 👋\n\nGue *AturUang* — SatuRuang buat atur keuangan lo.\n\n*Cara pakai:*\nCerita aja kayak chat biasa:\n• _makan soto 20k_\n• _kopi 35k di starbucks sama temen_\n• _grab 45k kemarin, males jalan_\n\n📸 *Foto struk/invoice juga bisa!*\nKirim foto struk ShopeeFood, GrabFood, atau struk belanja — gue baca otomatis.`,
      { parse_mode: "Markdown", reply_markup: dashboardKb }
    );

    await ctx.reply("Gas! Cerita pengeluaran lo 💸", { reply_markup: mainKeyboard });
  });

  bot.command("setpassword", async (ctx) => {
    const tgId = ctx.from?.id.toString();
    const args = ctx.message?.text?.split(" ").slice(1).join(" ");
    if (!tgId) return;

    if (!args || args.length < 4) {
      await ctx.reply("Format: `/setpassword <password>`\nMin 4 karakter.", { parse_mode: "Markdown" });
      return;
    }

    await prisma.user.upsert({
      where: { tgId },
      update: { password: args, name: ctx.from?.first_name },
      create: { tgId, password: args, name: ctx.from?.first_name },
    });

    const webUrl = process.env.WEB_URL || "https://aturuang.hanif.app";
    const user = await prisma.user.findUnique({ where: { tgId } });
    const loginId = user?.customId || tgId;
    await ctx.reply(
      `✅ Password udah ke-set!\n\nBuka dashboard di:\n${webUrl}\n\nLogin pake ID: \`${loginId}\`\n\n💡 Mau custom ID? Ketik /customid <id\_baru>`,
      { parse_mode: "Markdown" }
    );
  });

  bot.command("customid", async (ctx) => {
    const tgId = ctx.from?.id.toString();
    const args = ctx.message?.text?.split(" ").slice(1).join(" ").trim();
    if (!tgId) return;

    if (!args || args.length < 3) {
      await ctx.reply("Format: `/customid <id_baru>`\nMin 3 karakter, huruf/angka/underscore aja.", { parse_mode: "Markdown" });
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(args)) {
      await ctx.reply("ID cuma boleh huruf, angka, sama underscore ya.");
      return;
    }

    // Check if customId already taken
    const existing = await prisma.user.findUnique({ where: { customId: args } });
    if (existing && existing.tgId !== tgId) {
      await ctx.reply("ID `" + args + "` udah dipake orang lain. Coba yang lain.", { parse_mode: "Markdown" });
      return;
    }

    await prisma.user.upsert({
      where: { tgId },
      update: { customId: args, name: ctx.from?.first_name },
      create: { tgId, customId: args, name: ctx.from?.first_name },
    });

    await ctx.reply(`✅ Custom ID ke-set: \`${args}\`\n\nSekarang lo bisa login pake ID ini.`, { parse_mode: "Markdown" });
  });

  bot.command("credits", async (ctx) => {
    const tgId = ctx.from?.id.toString();
    if (!tgId || tgId !== process.env.ADMIN_TG_ID) {
      await ctx.reply("Access denied.");
      return;
    }

    const credits = await getCredits();
    if (!credits) {
      await ctx.reply("Gagal fetch credits dari OpenRouter.");
      return;
    }

    await ctx.reply(
      `💳 *OpenRouter Credits*\n\nRemaining: *$${credits.remaining.toFixed(2)}*\nUsed: *$${credits.total_usage.toFixed(2)}*\nTotal: *$${credits.total_credits.toFixed(2)}*`,
      { parse_mode: "Markdown" }
    );
  });

  bot.command("today", async (ctx) => {
    const tgId = ctx.from?.id.toString();
    if (!tgId) return;

    const today = new Date();
    const expenses = await prisma.expense.findMany({
      where: { tgId, date: { gte: startOfDay(today), lte: endOfDay(today) } },
      orderBy: { createdAt: "desc" },
    });

    if (expenses.length === 0) {
      await ctx.reply("Belum ada pengeluaran hari ini ✨");
      return;
    }

    const total = expenses.reduce((s, e) => s + e.amount, 0);
    let msg = `📅 *${format(today, "EEEE, d MMM", { locale: id })}*\n\n`;
    for (const e of expenses) {
      msg += `${getEmoji(e.category)} ${e.item} — *${fmt(e.amount)}*\n`;
    }
    msg += `\n*Total: ${fmt(total)}*`;
    await ctx.reply(msg, { parse_mode: "Markdown" });
  });

  bot.command("week", async (ctx) => {
    const tgId = ctx.from?.id.toString();
    if (!tgId) return;

    const today = new Date();
    const expenses = await prisma.expense.findMany({
      where: {
        tgId,
        date: { gte: startOfWeek(today, { weekStartsOn: 1 }), lte: endOfWeek(today, { weekStartsOn: 1 }) },
      },
      orderBy: { date: "desc" },
    });

    if (expenses.length === 0) {
      await ctx.reply("Belum ada pengeluaran minggu ini ✨");
      return;
    }

    const total = expenses.reduce((s, e) => s + e.amount, 0);
    const byCategory = groupByCategory(expenses);
    let msg = `📊 *Minggu Ini*\n\n💰 *${fmt(total)}* dari ${expenses.length} transaksi\n\n`;
    const sorted = Object.entries(byCategory).sort((a, b) => b[1].total - a[1].total);
    for (const [cat, data] of sorted) {
      msg += `${getEmoji(cat)} ${cat} — ${fmt(data.total)}\n`;
    }
    await ctx.reply(msg, { parse_mode: "Markdown" });
  });

  bot.command("month", async (ctx) => {
    const tgId = ctx.from?.id.toString();
    if (!tgId) return;

    const today = new Date();
    const expenses = await prisma.expense.findMany({
      where: { tgId, date: { gte: startOfMonth(today), lte: endOfMonth(today) } },
      orderBy: { date: "desc" },
    });

    if (expenses.length === 0) {
      await ctx.reply("Belum ada pengeluaran bulan ini ✨");
      return;
    }

    const total = expenses.reduce((s, e) => s + e.amount, 0);
    const byCategory = groupByCategory(expenses);
    let msg = `📊 *${format(today, "MMMM yyyy", { locale: id })}*\n\n💰 *${fmt(total)}* dari ${expenses.length} transaksi\n\n`;
    const sorted = Object.entries(byCategory).sort((a, b) => b[1].total - a[1].total);
    for (const [cat, data] of sorted) {
      const pct = Math.round((data.total / total) * 100);
      msg += `${getEmoji(cat)} ${cat} — ${fmt(data.total)} (${pct}%)\n`;
    }
    await ctx.reply(msg, { parse_mode: "Markdown" });
  });

  bot.command("recent", async (ctx) => {
    const tgId = ctx.from?.id.toString();
    if (!tgId) return;

    const expenses = await prisma.expense.findMany({
      where: { tgId },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    if (expenses.length === 0) {
      await ctx.reply("Belum ada transaksi.");
      return;
    }

    let msg = `📝 *Recent*\n\n`;
    for (const e of expenses) {
      const date = format(e.date, "d/M", { locale: id });
      msg += `${getEmoji(e.category)} ${e.item} — *${fmt(e.amount)}*\n`;
      msg += `└ ${date}${e.place ? ` • ${e.place}` : ""}\n\n`;
    }
    await ctx.reply(msg, { parse_mode: "Markdown" });
  });

  bot.command("undo", async (ctx) => {
    const tgId = ctx.from?.id.toString();
    if (!tgId) return;

    const last = await prisma.expense.findFirst({
      where: { tgId },
      orderBy: { createdAt: "desc" },
    });

    if (!last) {
      await ctx.reply("Tidak ada transaksi.");
      return;
    }

    const keyboard = new InlineKeyboard()
      .text("🗑 Hapus", `del:${last.id}`)
      .text("✕ Batal", "cancel");

    await ctx.reply(`Hapus *${last.item}* — ${fmt(last.amount)}?`, { parse_mode: "Markdown", reply_markup: keyboard });
  });

  bot.callbackQuery(/^del:(.+)$/, async (ctx) => {
    const expId = ctx.match[1];
    await prisma.expense.delete({ where: { id: expId } });
    await ctx.editMessageText("✅ Dihapus");
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("cancel", async (ctx) => {
    await ctx.editMessageText("Dibatalkan");
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^delbatch:(.+)$/, async (ctx) => {
    const refId = ctx.match[1];
    const ref = await prisma.expense.findUnique({ where: { id: refId } });
    if (!ref) {
      await ctx.editMessageText("✅ Udah dihapus sebelumnya");
      await ctx.answerCallbackQuery();
      return;
    }
    await prisma.expense.deleteMany({
      where: {
        tgId: ref.tgId,
        rawMessage: ref.rawMessage,
        createdAt: {
          gte: new Date(ref.createdAt.getTime() - 2000),
          lte: new Date(ref.createdAt.getTime() + 2000),
        },
      },
    });
    await ctx.editMessageText("✅ Semua dihapus");
    await ctx.answerCallbackQuery();
  });

  bot.on("message:text", async (ctx) => {
    const tgId = ctx.from?.id.toString();
    const message = ctx.message.text;
    if (!tgId || message.startsWith("/")) return;

    // Handle reply keyboard buttons
    const buttonCmd = BUTTON_COMMANDS[message];
    if (buttonCmd) {
      await bot.handleUpdate({
        ...ctx.update,
        message: {
          ...ctx.update.message!,
          text: buttonCmd,
          entities: [{ type: "bot_command" as const, offset: 0, length: buttonCmd.length }],
        },
      });
      return;
    }

    await ctx.replyWithChatAction("typing");
    const result = await parseExpense(message);

    if (result.error || result.expenses.length === 0) {
      await ctx.reply("Hmm gue ga nangkep 🤔\n\nCoba gini: _makan soto 20k_", { parse_mode: "Markdown" });
      return;
    }

    const saved = [];
    for (const exp of result.expenses) {
      const expense = await prisma.expense.create({
        data: {
          amount: exp.amount,
          item: exp.item,
          category: exp.category,
          place: exp.place || null,
          withPerson: exp.withPerson || null,
          mood: exp.mood || null,
          story: exp.story || null,
          rawMessage: message,
          tgId,
          date: new Date(exp.date),
        },
      });
      saved.push(expense);
    }

    let msg = "✅ Noted!\n\n";
    for (const e of saved) {
      const mood = getMood(e.mood);
      msg += `${getEmoji(e.category)} *${e.item}* — ${fmt(e.amount)}${mood ? ` ${mood}` : ""}\n`;
      if (e.place) msg += `   📍 ${e.place}\n`;
      if (e.withPerson) msg += `   👥 ${e.withPerson}\n`;
      if (e.story) msg += `   💭 _${e.story}_\n`;
    }

    const todayTotal = await prisma.expense.aggregate({
      where: { tgId, date: { gte: startOfDay(new Date()), lte: endOfDay(new Date()) } },
      _sum: { amount: true },
    });

    msg += `\n📊 Total hari ini: *${fmt(todayTotal._sum.amount || 0)}*`;

    const deleteKb = new InlineKeyboard();
    if (saved.length === 1) {
      deleteKb.text("🗑 Hapus", `del:${saved[0].id}`);
    } else {
      for (const e of saved) {
        deleteKb.text(`🗑 ${e.item}`, `del:${e.id}`).row();
      }
    }
    await ctx.reply(msg, { parse_mode: "Markdown", reply_markup: deleteKb });
  });

  // Handle photo messages (receipts, invoices)
  bot.on("message:photo", async (ctx) => {
    const tgId = ctx.from?.id.toString();
    if (!tgId) return;

    await ctx.replyWithChatAction("typing");

    try {
      // Get the largest photo size
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const file = await ctx.api.getFile(photo.file_id);

      if (!file.file_path) {
        await ctx.reply("Ga bisa download foto 😅");
        return;
      }

      // Download the image
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      const response = await fetch(fileUrl);
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");

      // Parse the receipt
      const caption = ctx.message.caption;
      const result = await parseReceipt(base64, caption);

      if (result.error || result.expenses.length === 0) {
        await ctx.reply("Hmm gue ga bisa baca struk ini 🤔\n\nCoba foto yang lebih jelas atau ketik manual aja.", { parse_mode: "Markdown" });
        return;
      }

      // Save all expenses
      const saved = [];
      for (const exp of result.expenses) {
        const expense = await prisma.expense.create({
          data: {
            amount: exp.amount,
            item: exp.item,
            category: exp.category,
            place: exp.place || result.merchant || null,
            withPerson: null,
            mood: null,
            story: null,
            rawMessage: caption || "[receipt photo]",
            tgId,
            date: new Date(exp.date),
          },
        });
        saved.push(expense);
      }

      let msg = "🧾 *Struk terbaca!*\n\n";
      if (result.merchant) {
        msg += `📍 ${result.merchant}\n\n`;
      }
      for (const e of saved) {
        msg += `${getEmoji(e.category)} ${e.item} — *${fmt(e.amount)}*\n`;
      }

      const total = saved.reduce((s, e) => s + e.amount, 0);
      msg += `\n💰 *Total: ${fmt(total)}*`;

      const todayTotal = await prisma.expense.aggregate({
        where: { tgId, date: { gte: startOfDay(new Date()), lte: endOfDay(new Date()) } },
        _sum: { amount: true },
      });

      msg += `\n📊 Total hari ini: *${fmt(todayTotal._sum.amount || 0)}*`;

      const deleteKb = new InlineKeyboard();
      if (saved.length <= 3) {
        for (const e of saved) {
          deleteKb.text(`🗑 ${e.item}`, `del:${e.id}`).row();
        }
      } else {
        deleteKb.text("🗑 Hapus Semua", `delbatch:${saved[0].id}`);
      }
      await ctx.reply(msg, { parse_mode: "Markdown", reply_markup: deleteKb });
    } catch (error) {
      console.error("Photo processing error:", error);
      await ctx.reply("Error proses foto 😅 Coba lagi ya.");
    }
  });

  return bot;
}

function groupByCategory(expenses: { category: string; amount: number }[]) {
  const result: Record<string, { total: number; count: number }> = {};
  for (const e of expenses) {
    if (!result[e.category]) result[e.category] = { total: 0, count: 0 };
    result[e.category].total += e.amount;
    result[e.category].count++;
  }
  return result;
}
