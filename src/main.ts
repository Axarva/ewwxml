import { readFileSync } from 'fs'
import { performance } from 'perf_hooks'
import * as builtin from './builtin.js'

export function special_tag_handling(tag: string) {
	switch (tag.trim()) {
		case "var":
			return "defvar"
		default:
			return tag
	}
}

export function outputStrings(_: string) {


	//console.log('`' + _ + '`')
	// TODO: Deal with only one ref
	// TODO: Deal with indentation
	// TODO: Deal with vars right next to each other

	// Strip comments and check if is only spaces 
	if (_.replace(/;;.*/g, '').trim().length == 0) {
		return _
	}

	// Check for number
	if (!isNaN(Number(_.trim()))) {
		return _.trim()
	}

	// If is only one var-ref
	if (/^{{[^}]+?}}$/.test(_.trim())) {
		return _.replace(/}}|{{/, '').trim()
	}

	// Check for variables
	if (/(?<!'|".*){{.*}}(?!.*'|")/.test(_)) {
		return `"` + _.replace(/{{/g, '${').replace(/}}/g, '}') + `"`
	}

	return '"' + _.trim() + '"'
}

export const enum Importance {
	Anywhere = 0,
	ResolveChildren = 1,
	WillResolve = 2,
	RunAtEnd = 3
}

export interface Transformer {
	importance: Importance;
	fn: (a:string, state: State, args: Record<string, string>) => string;
}

export interface State {
	variables: string[];
}

export function fail(msg:string, do_exit:boolean=true) {
	console.error('\u001b[1m\u001b[31m[ERROR]\u001b[0m '+msg)
	do_exit ? process.exit(1) : null
}

export function warn (msg: string) {
	console.error('\u001b[1m\u001b[33m[WARNING]\u001b[0m '+msg)
}

export function parse_args(args: string) {
	// console.log(args)
	let obj: Record<string, string> = {}
	args.match(/(?:[^\s"]+|"[^"]*")+/g)?.forEach(i => {
		if (i.length < 1) { return }
		let x = i.split('=')
		let name = x[0]
		let value = x[1] ?? ""
		obj[name] = value.replace(/"/g, '')
	})
	return obj
}
export function to_lisp_args(y: Record<string, string>, seperator=' ') {
	let x =''
	Object.entries(y).forEach(([key, value]) => { 
		if (key == 'name') {
			x = value + ' ' + x 
		} else {

			// CHANGE: Now simply pass to quote string -- If it isnt a number add quotes
			value = outputStrings(value)

			x +=`:${key} ${value}${seperator}`
		}
	})
	return x
}

async function useBlockTransformer(data: string, obj: TransformerList, state: State) {
	if (Object.keys(obj).length <= 0) { return data }
	let regex = new RegExp(`<(${Object.keys(obj).map(v => v.toLowerCase().replace('_','-')).join('|')})(.*?)>([^]+?)</\\1>`, 'g') // MATCH ENTIRE BLOCK
	// console.log(regex) // DEBUG
	while (true) {
		data =  data.replace(regex, (match: string, tag: string, args: string, value: string) => {
			tag = tag.toLowerCase().replace(/-/g, '_')
			
			try {
				return (obj[tag] ? obj[tag].fn(value,state,parse_args(args)) : value)
			} catch (err) {
				fail(`Transformer: ${tag} failed to transform: ${value} ~ ${err}`);
				return match
			}
		})
		if (!regex.test(data)) { break }
	}
	return data
}

type TransformerList = Record<string, Transformer>;
class Context {
	data: string;
	state: State;
	transformers: TransformerList;

	constructor(file_path: string) {
		this.data = readFileSync(file_path, 'utf-8');
		this.transformers = { ...builtin }
		this.state = {
			variables: this.data.match(/(?<=<(script-)?var.*?name=")[^"]+/g) ?? []
		}
		// console.log(this.transformers) // DEBUG
	}
	
	preTransform() {

		// Remove tags that are no longer needed
		this.data = this.data.replace(/<\/?(eww|includes|definitions|variables|windows|includes|widget).*>/g, '')
		
		// Transform comments
		this.data = this.data.replace(/<!--([^]*?)-->/g, (_:string,match:string)=> match.split('\n').map(e => ';; '+e.trim()).join('\n'))

		this.data = this.data.replace(/	/g, '        ') // Sorry tab gods
	
		this.data = this.data.replace(/(?<=>)[^<>]+?(?=<)/g, outputStrings)
	}

	prettify () {
		this.data = this.data.replace(/\s+\)/g, ')')  // get rid of stuff like ` )` to `)`
		this.data = this.data.replace(/\)(\s+)\(/g, (_: string, space: string) => `)\n${space.replace(/\n/g, '')}(`) // fix weird ()
		this.data = this.data.replace(/\n(\s*["}]+?\)+)/g, (_: string, x: string) => x) // more of that
	}

	async transform() {
		// Replace Emoji & Unicode (if --ascii)
		this.preTransform()

		// -- Simple Processing --
		this.data = await useBlockTransformer(this.data, this.transformers, this.state)

		const matchAnyBlocks = /<(\S+)(.*?)>([^]*?)<\/\1>/g
		while (true) {
			this.data = this.data.replace(matchAnyBlocks, (_, tag: string, arg:string, value: string) => '(' + special_tag_handling(tag) + ' ' + to_lisp_args(parse_args(arg)) + value + ')')
			if (!matchAnyBlocks.test(this.data)) { break }
		}

		const matchOneWord = /<(\S+)(.*)\/>/g
		while (true) {
			this.data = this.data.replace(matchOneWord, (_, tag: string, args: string) => '('+tag+' '+to_lisp_args(parse_args(args))+')')
			if (!matchOneWord.test(this.data)) { break }
		}

		this.prettify()
	}
}

(async () => {
let instance = new Context(process.argv[2])

const start = performance.now()
await instance.transform()
const end = performance.now()

console.log(instance.data)
console.error(`Finished transforming in \u001b[1m${Math.floor(end-start)}\u001b[0mms`)
})()

// TODO: Make output not trash
