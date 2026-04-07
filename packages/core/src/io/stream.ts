export class WritableBuffer {
	private parts: string[] = [];

	write(data: string): void {
		this.parts.push(data);
	}

	writeln(data: string): void {
		this.parts.push(data + "\n");
	}

	toString(): string {
		return this.parts.join("");
	}

	clear(): void {
		this.parts = [];
	}

	get length(): number {
		let total = 0;
		for (const part of this.parts) {
			total += part.length;
		}
		return total;
	}
}
