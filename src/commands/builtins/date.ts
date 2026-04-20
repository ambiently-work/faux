import { command } from "../builder.js";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];
const MONTHS_SHORT = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

export const date = command("date")
	.description("Display or set the system date and time")
	.flag("-u, --utc", "Use UTC time")
	.option("-d, --date <datestr>", "Display time described by datestr")
	.allowUnknownFlags()
	.argument("[+format]", "Output format string")
	.action((ctx, { args, flags }) => {
		const utc = flags.utc as boolean;
		const dateRef = flags.date as string | undefined;

		// Find the format arg (starts with +)
		let format: string | undefined;
		for (const arg of args) {
			if (arg.startsWith("+")) {
				format = arg.slice(1);
			}
		}

		const now = dateRef ? new Date(dateRef) : new Date();

		if (Number.isNaN(now.getTime())) {
			ctx.stderr.writeln(`date: invalid date '${dateRef}'`);
			return 1;
		}

		if (format === undefined) {
			const day = utc ? WEEKDAYS_SHORT[now.getUTCDay()] : WEEKDAYS_SHORT[now.getDay()];
			const mon = utc ? MONTHS_SHORT[now.getUTCMonth()] : MONTHS_SHORT[now.getMonth()];
			const dd = utc ? now.getUTCDate() : now.getDate();
			const h = pad2(utc ? now.getUTCHours() : now.getHours());
			const m = pad2(utc ? now.getUTCMinutes() : now.getMinutes());
			const s = pad2(utc ? now.getUTCSeconds() : now.getSeconds());
			const year = utc ? now.getUTCFullYear() : now.getFullYear();
			const tz = utc ? "UTC" : getTimezoneAbbr(now);
			ctx.stdout.writeln(
				`${day} ${mon} ${String(dd).padStart(2, " ")} ${h}:${m}:${s} ${tz} ${year}`,
			);
			return 0;
		}

		const output = formatDate(now, format, utc);
		ctx.stdout.writeln(output);
		return 0;
	})
	.toHandler();

function pad2(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

function formatDate(d: Date, fmt: string, utc: boolean): string {
	let result = "";
	let i = 0;

	while (i < fmt.length) {
		if (fmt[i] === "%") {
			i++;
			if (i >= fmt.length) {
				result += "%";
				break;
			}

			const spec = fmt[i];
			switch (spec) {
				case "Y":
					result += String(utc ? d.getUTCFullYear() : d.getFullYear());
					break;
				case "y":
					result += String(utc ? d.getUTCFullYear() : d.getFullYear()).slice(-2);
					break;
				case "C":
					result += String(Math.floor((utc ? d.getUTCFullYear() : d.getFullYear()) / 100));
					break;
				case "D":
					result += `${pad2((utc ? d.getUTCMonth() : d.getMonth()) + 1)}/${pad2(utc ? d.getUTCDate() : d.getDate())}/${String(utc ? d.getUTCFullYear() : d.getFullYear()).slice(-2)}`;
					break;
				case "m":
					result += pad2((utc ? d.getUTCMonth() : d.getMonth()) + 1);
					break;
				case "d":
					result += pad2(utc ? d.getUTCDate() : d.getDate());
					break;
				case "H":
					result += pad2(utc ? d.getUTCHours() : d.getHours());
					break;
				case "M":
					result += pad2(utc ? d.getUTCMinutes() : d.getMinutes());
					break;
				case "S":
					result += pad2(utc ? d.getUTCSeconds() : d.getSeconds());
					break;
				case "s":
					result += String(Math.floor(d.getTime() / 1000));
					break;
				case "N":
					result += String(d.getMilliseconds() * 1000000).padStart(9, "0");
					break;
				case "A":
					result += WEEKDAYS[utc ? d.getUTCDay() : d.getDay()];
					break;
				case "a":
					result += WEEKDAYS_SHORT[utc ? d.getUTCDay() : d.getDay()];
					break;
				case "B":
					result += MONTHS[utc ? d.getUTCMonth() : d.getMonth()];
					break;
				case "b":
				case "h":
					result += MONTHS_SHORT[utc ? d.getUTCMonth() : d.getMonth()];
					break;
				case "Z":
					result += utc ? "UTC" : getTimezoneAbbr(d);
					break;
				case "z": {
					if (utc) {
						result += "+0000";
					} else {
						const offset = -d.getTimezoneOffset();
						const sign = offset >= 0 ? "+" : "-";
						const absOff = Math.abs(offset);
						result += `${sign}${pad2(Math.floor(absOff / 60))}${pad2(absOff % 60)}`;
					}
					break;
				}
				case "F":
					result += `${utc ? d.getUTCFullYear() : d.getFullYear()}-${pad2((utc ? d.getUTCMonth() : d.getMonth()) + 1)}-${pad2(utc ? d.getUTCDate() : d.getDate())}`;
					break;
				case "T":
					result += `${pad2(utc ? d.getUTCHours() : d.getHours())}:${pad2(utc ? d.getUTCMinutes() : d.getMinutes())}:${pad2(utc ? d.getUTCSeconds() : d.getSeconds())}`;
					break;
				case "R":
					result += `${pad2(utc ? d.getUTCHours() : d.getHours())}:${pad2(utc ? d.getUTCMinutes() : d.getMinutes())}`;
					break;
				case "c": {
					const day = WEEKDAYS_SHORT[utc ? d.getUTCDay() : d.getDay()];
					const mon = MONTHS_SHORT[utc ? d.getUTCMonth() : d.getMonth()];
					const dd = utc ? d.getUTCDate() : d.getDate();
					const hh = pad2(utc ? d.getUTCHours() : d.getHours());
					const mm = pad2(utc ? d.getUTCMinutes() : d.getMinutes());
					const ss = pad2(utc ? d.getUTCSeconds() : d.getSeconds());
					const year = utc ? d.getUTCFullYear() : d.getFullYear();
					result += `${day} ${mon} ${String(dd).padStart(2, " ")} ${hh}:${mm}:${ss} ${year}`;
					break;
				}
				case "e":
					result += String(utc ? d.getUTCDate() : d.getDate()).padStart(2, " ");
					break;
				case "j": {
					const start = new Date(utc ? d.getUTCFullYear() : d.getFullYear(), 0, 0);
					const diff = d.getTime() - start.getTime();
					const dayOfYear = Math.floor(diff / 86400000);
					result += String(dayOfYear).padStart(3, "0");
					break;
				}
				case "I": {
					let h = utc ? d.getUTCHours() : d.getHours();
					h = h % 12 || 12;
					result += pad2(h);
					break;
				}
				case "l": {
					let h = utc ? d.getUTCHours() : d.getHours();
					h = h % 12 || 12;
					result += String(h).padStart(2, " ");
					break;
				}
				case "p":
					result += (utc ? d.getUTCHours() : d.getHours()) < 12 ? "AM" : "PM";
					break;
				case "P":
					result += (utc ? d.getUTCHours() : d.getHours()) < 12 ? "am" : "pm";
					break;
				case "u": {
					const dow = utc ? d.getUTCDay() : d.getDay();
					result += String(dow === 0 ? 7 : dow);
					break;
				}
				case "w":
					result += String(utc ? d.getUTCDay() : d.getDay());
					break;
				case "n":
					result += "\n";
					break;
				case "t":
					result += "\t";
					break;
				case "%":
					result += "%";
					break;
				default:
					result += `%${spec}`;
					break;
			}
			i++;
		} else {
			result += fmt[i];
			i++;
		}
	}

	return result;
}

function getTimezoneAbbr(d: Date): string {
	const str = d.toTimeString();
	const match = /\(([^)]+)\)/.exec(str);
	if (match) {
		const parts = match[1].split(" ");
		if (parts.length > 1) {
			return parts.map((p) => p[0]).join("");
		}
		return match[1];
	}
	const offset = -d.getTimezoneOffset();
	const sign = offset >= 0 ? "+" : "-";
	const absOff = Math.abs(offset);
	return `UTC${sign}${pad2(Math.floor(absOff / 60))}${pad2(absOff % 60)}`;
}
