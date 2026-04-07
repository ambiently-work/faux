import type { CommandHandler } from "./types.js";

export class CommandRegistry {
	private commands = new Map<string, CommandHandler>();

	register(handler: CommandHandler): void {
		this.commands.set(handler.name, handler);
	}

	registerAll(handlers: CommandHandler[]): void {
		for (const h of handlers) {
			this.register(h);
		}
	}

	get(name: string): CommandHandler | undefined {
		return this.commands.get(name);
	}

	has(name: string): boolean {
		return this.commands.has(name);
	}

	remove(name: string): boolean {
		return this.commands.delete(name);
	}

	list(): string[] {
		return [...this.commands.keys()].sort();
	}
}
