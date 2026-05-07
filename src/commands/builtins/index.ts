import type { CommandHandler } from "../types.js";

import { alias, unalias } from "./alias.js";
import { awk } from "./awk.js";
import { base64 } from "./base64.js";
import { basename } from "./basename.js";
import { bc } from "./bc.js";
import { breakCmd, continueCmd } from "./break-continue.js";
import { cat } from "./cat.js";
import { cd } from "./cd.js";
import { chmod } from "./chmod.js";
import { column } from "./column.js";
import { comm } from "./comm.js";
import { cp } from "./cp.js";
import { cut } from "./cut.js";
import { date } from "./date.js";
import { df } from "./df.js";
import { diff } from "./diff.js";
import { dirname } from "./dirname.js";
import { du } from "./du.js";
import { echo } from "./echo.js";
import { env, printenv } from "./env.js";
import { evalCmd } from "./eval.js";
import { exec } from "./exec.js";
import { exit, returnCmd } from "./exit-return.js";
import { expand } from "./expand.js";
import { declareCmd, exportCmd, local, readonly, unset } from "./export.js";
import { expr } from "./expr.js";
import { file } from "./file.js";
import { find } from "./find.js";
import { fmt } from "./fmt.js";
import { fold } from "./fold.js";
import { getopts } from "./getopts.js";
import { grep } from "./grep.js";
import { head } from "./head.js";
import { hostname } from "./hostname.js";
import { id, whoami } from "./id.js";
import { bg, fg, jobs, kill, suspend, times, wait } from "./jobs.js";
import { join } from "./join.js";
import { letCmd } from "./let.js";
import { ln } from "./ln.js";
import { ls } from "./ls.js";
import { mapfile, readarray } from "./mapfile.js";
import { arch, cal, md5sum, nproc, sha256sum, uptime } from "./misc.js";
import { mkdir } from "./mkdir.js";
import { mktemp } from "./mktemp.js";
import { mv } from "./mv.js";
import { nl } from "./nl.js";
import { paste } from "./paste.js";
import { printf } from "./printf.js";
import { pwd } from "./pwd.js";
import { read } from "./read.js";
import { realpath } from "./realpath.js";
import { rev } from "./rev.js";
import { rm } from "./rm.js";
import { sed } from "./sed.js";
import { seq } from "./seq.js";
import { set, shopt } from "./set-shopt.js";
import { shift } from "./shift.js";
import { sleep } from "./sleep.js";
import { sort } from "./sort.js";
import { dot, source } from "./source.js";
import { stat } from "./stat.js";
import { strings } from "./strings.js";
import { tac } from "./tac.js";
import { tail } from "./tail.js";
import { tee } from "./tee.js";
import { bracket, doubleBracket, test } from "./test.js";
import { timeCmd, timeout } from "./time-timeout.js";
import { touch } from "./touch.js";
import { tr } from "./tr.js";
import { trap } from "./trap.js";
import { tree } from "./tree.js";
import { falseCmd, noop, trueCmd } from "./true-false.js";
import { builtin, command, enable, hash, type, which } from "./type-which.js";
import { ulimit } from "./ulimit.js";
import { umask } from "./umask.js";
import { uname } from "./uname.js";
import { unexpand } from "./unexpand.js";
import { uniq } from "./uniq.js";
import { wc } from "./wc.js";
import { xargs } from "./xargs.js";
import { xxd } from "./xxd.js";
import { yes } from "./yes.js";

export const allBuiltins: CommandHandler[] = [
	alias,
	arch,
	awk,
	base64,
	basename,
	bc,
	bg,
	bracket,
	breakCmd,
	builtin,
	cal,
	cat,
	cd,
	chmod,
	column,
	comm,
	command,
	continueCmd,
	cp,
	cut,
	date,
	declareCmd,
	df,
	diff,
	dirname,
	dot,
	doubleBracket,
	du,
	echo,
	enable,
	env,
	evalCmd,
	exec,
	exit,
	expand,
	exportCmd,
	expr,
	falseCmd,
	fg,
	file,
	find,
	fmt,
	fold,
	getopts,
	grep,
	hash,
	head,
	hostname,
	id,
	jobs,
	join,
	kill,
	letCmd,
	ln,
	local,
	ls,
	mapfile,
	md5sum,
	mkdir,
	mktemp,
	mv,
	nl,
	noop,
	nproc,
	paste,
	printenv,
	printf,
	pwd,
	read,
	readarray,
	readonly,
	realpath,
	returnCmd,
	rev,
	rm,
	sed,
	seq,
	set,
	sha256sum,
	shift,
	shopt,
	sleep,
	sort,
	source,
	stat,
	strings,
	suspend,
	tac,
	tail,
	tee,
	test,
	timeCmd,
	timeout,
	times,
	touch,
	tr,
	trap,
	tree,
	trueCmd,
	type,
	ulimit,
	umask,
	unalias,
	uname,
	unexpand,
	uniq,
	unset,
	uptime,
	wait,
	wc,
	which,
	whoami,
	xargs,
	xxd,
	yes,
];
