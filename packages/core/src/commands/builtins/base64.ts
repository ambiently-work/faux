import { command } from "../builder.js";

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeBase64(input: string): string {
	let result = "";
	let i = 0;
	while (i < input.length) {
		const a = input.charCodeAt(i++);
		const b = i < input.length ? input.charCodeAt(i++) : 0;
		const c = i < input.length ? input.charCodeAt(i++) : 0;
		const padding = i - input.length;

		const triplet = (a << 16) | (b << 8) | c;
		result += BASE64_CHARS[(triplet >> 18) & 0x3f];
		result += BASE64_CHARS[(triplet >> 12) & 0x3f];
		result += padding > 1 ? "=" : BASE64_CHARS[(triplet >> 6) & 0x3f];
		result += padding > 0 ? "=" : BASE64_CHARS[triplet & 0x3f];
	}
	return result;
}

function decodeBase64(input: string): string {
	const cleaned = input.replace(/[\s\n\r]/g, "");
	const lookup = new Map<string, number>();
	for (let i = 0; i < BASE64_CHARS.length; i++) {
		lookup.set(BASE64_CHARS[i], i);
	}

	let result = "";
	let i = 0;
	while (i < cleaned.length) {
		const a = lookup.get(cleaned[i++]) ?? 0;
		const b = lookup.get(cleaned[i++]) ?? 0;
		const c = cleaned[i] === "=" ? 0 : (lookup.get(cleaned[i]) ?? 0);
		const d = cleaned[i + 1] === "=" ? 0 : (lookup.get(cleaned[i + 1]) ?? 0);
		const isPadC = cleaned[i] === "=";
		const isPadD = cleaned[i + 1] === "=";
		i += 2;

		const triplet = (a << 18) | (b << 12) | (c << 6) | d;
		result += String.fromCharCode((triplet >> 16) & 0xff);
		if (!isPadC) result += String.fromCharCode((triplet >> 8) & 0xff);
		if (!isPadD) result += String.fromCharCode(triplet & 0xff);
	}
	return result;
}

export const base64 = command("base64")
	.description("Base64 encode/decode data")
	.flag("-d, --decode", "Decode data")
	.flag("-D, --Decode", "Decode data (macOS compat)")
	.number("-w, --wrap <n>", "Wrap encoded lines after n characters", { default: 76 })
	.argument("[file...]", "Input files")
	.action((ctx, { args: files, flags }) => {
		const decode = (flags.decode as boolean) || (flags.Decode as boolean);
		const wrap = flags.wrap as number;

		let input: string;
		if (files.length > 0) {
			const parts: string[] = [];
			for (const file of files) {
				try {
					parts.push(ctx.fs.readFile(ctx.resolve(file)));
				} catch {
					ctx.stderr.writeln(`base64: ${file}: No such file or directory`);
					return 1;
				}
			}
			input = parts.join("");
		} else {
			input = ctx.stdin;
		}

		if (decode) {
			const result = decodeBase64(input);
			ctx.stdout.write(result);
		} else {
			const encoded = encodeBase64(input);
			if (wrap > 0) {
				let wrapped = "";
				for (let j = 0; j < encoded.length; j += wrap) {
					wrapped += encoded.slice(j, j + wrap) + "\n";
				}
				ctx.stdout.write(wrapped);
			} else {
				ctx.stdout.writeln(encoded);
			}
		}

		return 0;
	})
	.toHandler();
