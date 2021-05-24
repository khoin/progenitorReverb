/*
In jurisdictions that recognize copyright laws, this software is to
be released into the public domain.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
THE AUTHOR(S) SHALL NOT BE LIABLE FOR ANYTHING, ARISING FROM, OR IN
CONNECTION WITH THE SOFTWARE OR THE DISTRIBUTION OF THE SOFTWARE.
*/

class ProgenitorReverb extends AudioWorkletProcessor {
	
	static get parameterDescriptors() {

	}

	constructor(options) {
		super(options); 
		const s = sampleRate/34125;

		this.basket = [];
		const _ = new Proxy(this, { 
			set: (target, prop, val, receiver) => {
				this.basket.push(val);
				Reflect.set(target, prop, val);
				return true;
			}
		});

		const BANW = 0.999,
			  DAMP = 0.908,
			  DEC1 = 0.989,
			  DIF2 = 0.615,
			  DEC2 = 0.984,
			  DIF1 = 0.612,
			  DEC3 = 0.985,
			  DFTN = 0.455,
			  DCDF = 0.476;

		_.lp1 = new OnePoleLP(BANW);
		_.lx1 = new Delay(1);
		_.lp2 = new OnePoleLP(0.125);
		_.dp1 = new OnePoleLP(DAMP);

		_.df2 = new AllPass(239*s, DIF2, DEC2);
		_.dx1 = new Delay(2);
		_.df1 = new AllPass(392*s, DIF1, DEC3);
		_.dx2 = new Delay(1055*s);

		_.dd1 = new AllPassNest(612*s, DCDF, DEC2);
		_.dd1.add(new AllPass(1944*s, DFTN, DEC1));
		_.dx3 = new Delay(344*s);
		_.dd2 = new AllPassNest(1264*s, DCDF, DEC2);
		_.dd2.add(new AllPassNest(816*s, DFTN, DEC1))
			 .add(new AllPassNest(1, DFTN, DEC1, false))
			 .add(new Vibrato(1212*s, 121*s, 1.5/sampleRate), new CombForward(0.781));
		_.xxx = new Delay(1572*s);
// ----
		_.lp3 = new OnePoleLP(BANW);
		_.lx3 = new Delay(1);
		_.lp4 = new OnePoleLP(0.125);
		_.dp2 = new OnePoleLP(DAMP);

		_.df3 = new AllPass(205*s, DIF2, DEC2);
		_.dx4 = new Delay(1);
		_.df4 = new AllPass(329*s, DIF1, DEC3);
		_.dx5 = new Delay( (625 + 835)*s);

		_.dd3 = new AllPassNest(368*s, DCDF, DEC2);
		_.dd3.add(new AllPass(2032*s, DFTN, DEC1));
		_.dx6 = new Delay(500*s);
		_.dd4 = new AllPassNest(1340*s, DCDF, DEC2);
		_.dd4.add(new AllPassNest(688*s, DFTN, DEC1))
			 .add(new AllPassNest(1, DFTN, DEC1, false))
			 .add(new Vibrato(1452*s, 5*s, 2/sampleRate ), new CombForward(0.188));
		_.yyy = new Delay(16*s);

		// _.vibrato = new Vibrato(1212*s, 121*s, 1.5/sampleRate);

	}

	// First input will be downmixed to mono if number of channels is not 2
	// Outputs Stereo.
	process(inputs, outputs, parameters) {
		const s = sampleRate/34125;

		let i = 0|0;
		let input = inputs[0];
		const MIX = 1;
		const KEEP = 1.6;
		const IN = 1;
		while (i < 128) {
			//this.vibrato.write(input[0][i]);
			this.lp1.write(input[0][i]);
			this.lx1.write(this.lp1.read());
			this.lp2.write(this.yyy.read())
			this.dp1.write(  IN*this.lx1.read()  
							+   KEEP *(this.lp2.read() * (1-MIX)/2 + this.yyy.read() * MIX/2));

			this.df2.write(this.dp1.read());
			this.dx1.write(this.df2.read());
			this.df1.write(this.dx1.read());
			this.dx2.write(this.df1.read());

			this.dd1.write(this.dx2.read());
			this.dx3.write(this.dd1.read());
			this.dd2.write(this.dx3.read());
			this.xxx.write(this.dd2.read());

			this.lp3.write(input[1][i]);
			this.lx3.write(this.lp3.read());
			this.lp3.write(this.xxx.read());
			this.dp2.write( IN*this.lx3.read() 
							+  KEEP *(this.lp3.read() * (1-MIX)/2 + this.xxx.read() * MIX/2));

			this.df3.write(this.dp2.read());
			this.dx4.write(this.df3.read());
			this.df4.write(this.dx4.read());
			this.dx5.write(this.df4.read());

			this.dd3.write(this.dx5.read());
			this.dx6.write(this.dd3.read());
			this.dd4.write(this.dx6.read());
			this.yyy.write(this.dd4.read());

			outputs[0][0][i] = this.dx3.readAt(~~(276*s)) * 0.938;
			outputs[0][1][i] = this.dx6.readAt(~~(468*s)) * 0.438 + this.dx5.readAt(~~(625*s)) * 0.938
							 - this.dx3.readAt(~~(312*s)) * 0.438 + this.yyy.readAt(~~(8*s)) * 0.125;

			// c = this.dx6.readAt(~~(24*s)  * 0.938 + this.xxx.readAt(~(36*s)) * 0.469);


			this.basket.forEach(_ => _.update());
			i++;
		}

		return true;
	}
}

class Delay {
	constructor(length) {
		length |= 0; // round down no matta what.

		let nextPowerOfTwo = 2**Math.ceil(Math.log2((length)));

		this.tape = new Float32Array(nextPowerOfTwo);
		// indices / pointers
		this.pRead = 0;
		this.pWrite = length - 1;
	}

	update() {
		this.pRead = (this.pRead + 1) & (this.tape.length - 1);
		this.pWrite = (this.pWrite + 1) & (this.tape.length - 1);
	}

	write(input) {
		return this.tape[this.pWrite] = input;
	}

	read() {
		return this.tape[this.pRead];
	}

	readAt(index) {
		return this.tape[(this.pRead + index) & (this.tape.length - 1)];
	}

	// source: O. Niemitalo: https://www.musicdsp.org/en/latest/Other/49-cubic-interpollation.html
	readCubicAt(i) {
		let int  = ~~i + this.pRead - 1;
			
		const frac = i-~~i,
			mask = this.tape.length - 1,

			x0 = this.tape[int++ & mask],
			x1 = this.tape[int++ & mask],
			x2 = this.tape[int++ & mask],
			x3 = this.tape[int   & mask],

			a  = (3*(x1-x2) - x0 + x3) / 2,
			b  = 2*x2 + x0 - (5*x1+x3) / 2,
			c  = (x2-x0) / 2;

		return (((a * frac) + b) * frac + c) * frac + x1;
	}
}
class Vibrato {
	constructor(length, depth = 5, rate = 1.0) {
		length |= 0; // round down no matta what.
		depth |= 0;

		let nextPowerOfTwo = 2**Math.ceil(Math.log2((length + depth*2)));

		this.tape = new Float32Array(nextPowerOfTwo);
		this.depth = depth;
		this.rate = rate;
		this.phase = Math.random();
		// indices / pointers
		this.pRead = depth;
		this.pWrite = length - 1;
	}

	update() {
		this.pRead = (this.pRead + 1) & (this.tape.length - 1);
		this.pWrite = (this.pWrite + 1) & (this.tape.length - 1);
		this.phase += 2*Math.PI * this.rate;
	}

	write(input) {
		return this.tape[this.pWrite] = input;
	}

	read() {
		return this.readCubicAt(Math.cos(this.phase)*this.depth);
	}

	readAt(index) {
		return this.tape[(this.pRead + index) & (this.tape.length - 1)];
	}

	// source: O. Niemitalo: https://www.musicdsp.org/en/latest/Other/49-cubic-interpollation.html
	readCubicAt(i) {
		let int  = ~~i + this.pRead - 1;
			
		const frac = i-~~i,
			mask = this.tape.length - 1,

			x0 = this.tape[int++ & mask],
			x1 = this.tape[int++ & mask],
			x2 = this.tape[int++ & mask],
			x3 = this.tape[int   & mask],

			a  = (3*(x1-x2) - x0 + x3) / 2,
			b  = 2*x2 + x0 - (5*x1+x3) / 2,
			c  = (x2-x0) / 2;

		return (((a * frac) + b) * frac + c) * frac + x1;
	}
}

class AllPass {
	constructor(length, k = 0.5, decay = 1.0) {
		this.d = new Delay(length);
		this.k = k;
		this.decay = decay;
		this.inputNode = 0.0;
	}

	update () {
		this.d.update()
	}

	write(input) {
		this.inputNode = this.d.read() * this.k + input;
		return this.d.write(this.inputNode);
	}

	read() {
		return this.d.read() * this.decay + this.inputNode * this.k * -1;
	}
}

class Nestable {
	constructor () {
		this.nested = [];
	}

	add (obj) {
		this.nested.push(obj);
		return obj;
	}

	series() {
		this.nested.push(...arguments);
		return this;
	}
}

class AllPassNest extends Nestable {
	constructor(length, k = 0.5, decay = 1.0, defaultDelay = true) {
		super();
		this.d = new Delay(length);
		this.k = k;
		this.decay = decay;
		this.inputNode = 0.0;
		this.dfDelay = defaultDelay;

		return this;
	}

	update () {
		this.d.update();
		for (let i = 0; i < this.nested.length; i++)
			this.nested[i].update();
	}

	write(input) {
		this.inputNode = this.d.read() * this.k + input;
		let last = this.inputNode;
		for (let i = 0; i < this.nested.length; i++) {
			this.nested[i].write(last);
			last = this.nested[i].read();
		}
		if (this.dfDelay)
			return this.d.write(last);
		else
			return last;
	}

	read() {
		return this.d.read() * this.decay + this.inputNode * this.k * -1;
	}
}

class OnePoleLP {
	constructor(bwidth) {
		this.d = new Delay(1);
		this.a = bwidth;
		this.inputNode = 0.0;
	}

	update() {
		this.d.update();
	}

	write(input) {
		this.inputNode = this.d.read() * (1 - this.a) + input * this.a;
		return this.d.write(this.inputNode);
	}

	read() {
		return this.inputNode;
	}
}

class CombForward {
	constructor(k) {
		this.d = new Delay(1);
		this.k = k;
		this.inputNode = 0.0;
	}
	update() {
		this.d.update();
	}
	write(input) {
		this.inputNode = input;
		return this.d.write(input);
	}
	read() {
		return this.inputNode * this.k + this.d.read() * (1 - this.k);
	}
}

registerProcessor('ProgenitorReverb', ProgenitorReverb);