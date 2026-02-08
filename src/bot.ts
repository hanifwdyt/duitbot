import { Bot, InlineKeyboard } from "grammy";
import { PrismaClient } from "@prisma/client";
import { parseExpense } from "./ai.js";
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

export function createBot(token: string) {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    const name = ctx.from?.first_name || "there";
    await ctx.reply(
      `Yo ${name}! 👋\n\nGue *AturUang* — SatuRuang buat atur keuangan lo.\n\n*Cara pakai:*\nCerita aja kayak chat biasa:\n• _makan soto 20k_\n• _kopi 35k di starbucks sama temen_\n• _grab 45k kemarin, males jalan_\n\n*Commands:*\n/today • /week • /month\n/recent • /undo • /setpassword\n\nGas! 💸`,
      { parse_mode: "Markdown" }
    );
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
    await ctx.reply(
      `✅ Password udah ke-set!\n\nBuka dashboard di:\n${webUrl}\n\nLogin pake ID: \`${tgId}\``,
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

  bot.on("message:text", async (ctx) => {
    const tgId = ctx.from?.id.toString();
    const message = ctx.message.text;
    if (!tgId || message.startsWith("/")) return;

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
    await ctx.reply(msg, { parse_mode: "Markdown" });
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
