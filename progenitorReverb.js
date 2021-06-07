/*
In jurisdictions that recognize copyright laws, this software is to
be released into the public domain.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
THE AUTHOR(S) SHALL NOT BE LIABLE FOR ANYTHING, ARISING FROM, OR IN
CONNECTION WITH THE SOFTWARE OR THE DISTRIBUTION OF THE SOFTWARE.
*/

class ProgenitorReverb extends AudioWorkletProcessor {
	
	static get parameterDescriptors() {
		return [	
			["bandwidth"     , 0.812 , 0    , 1   , "k-rate"],	
			["damping"       , 0.688 , 0    , 1   , "k-rate"],	
			["decay1"        , 0.938 , 0.15 , 0.99, "k-rate"],
			["diffusion1"    , 0.312 , 0    , 0.95, "k-rate"],
			["decay2"        , 0.844 , 0.15 , 0.99, "k-rate"],
			["diffusion2"    , 0.375 , 0    , 0.95, "k-rate"],
			["definition"    , 0.25  , 0    , 0.45, "k-rate"],
			["decay3"        , 0.906 , 0.15 , 0.99, "k-rate"],
			["decayDiffusion", 0.406 , 0    , 0.80, "k-rate"],
		].map(x => new Object({
			name: x[0],
			defaultValue: x[1],
			minValue: x[2],
			maxValue: x[3],
			automationRate: x[4]
		}));
	}

	constructor(options) {
		super(options); 
		const s = sampleRate/34125;

		this.basket = [];
		this.A = {};
		this.B = {};
		const _ = new Proxy(this, { 
			set: (target, prop, val, receiver) => {
				this.basket.push(val);
				this[prop[0] == "A" ? "A" : "B"][prop.substr(1)] = val;
				return Reflect.set(target, prop, val);
			}
		});

		const defVal = name => ProgenitorReverb.parameterDescriptors.find(_ => _.name == name).defaultValue;

		[ 
			[1, 0.125, 239, 2, 392, 1055   , 612, 1944, 344, 1264, 816, 1212, 121, 0.301, 0.781, 1572],
			[1, 0.125, 205, 1, 329, 625+935, 368, 2032, 500, 1340, 688, 1452,  5 , 0.412, 0.188,   16]
		].forEach((wing, i) => {
			wing = wing.map(_ => _*s);
			i = i > 0 ? "B" : "A";

			_[i+"entryLPF"] = new OnePoleLP  (defVal("bandwidth"));
			_[i+"entryDLY"] = new Delay      (wing[0]);
			_[i+"tankLPF" ] = new OnePoleLP  (wing[1]);
			_[i+"mixedLPF"] = new OnePoleLP  (defVal("damping"));

			_[i+"dif1APF"] = new AllPass     (wing[2], defVal("diffusion2"), defVal("decay2"));
			_[i+"dif1DLY"] = new Delay       (wing[3]);
			_[i+"dif2APF"] = new AllPass     (wing[4], defVal("diffusion1"), defVal("decay3"));
			_[i+"dif2DLY"] = new Delay       (wing[5]);

			_[i+"dif3APN"] = new AllPassNest (wing[6], defVal("decayDiffusion"), defVal("decay2"));
				this[i].dif3APN.add(this[i].dif3APNa = new AllPass(wing[7], defVal("definition"), defVal("decay1")));
			_[i+"dif3DLY"] = new Delay       (wing[8]);

			_[i+"dif4APN"] = new AllPassNest (wing[9], defVal("decayDiffusion"), defVal("decay2"))
				this[i].dif4APN	.add(this[i].dif4APNa = new AllPassNest(wing[10], defVal("definition"), defVal("decay1")))	
								.add(this[i].dif4APNb = new AllPassNest(1, defVal("definition"), defVal("decay1"), false))
						 		.series(new Vibrato(wing[11], wing[12], wing[13]/sampleRate), new CombForward(wing[14]))
			_[i+"tankOut"] = new Delay(wing[15]);
		});
	}

	// First input will be downmixed to mono if number of channels is not 2
	// Outputs Stereo.
	process(inputs, outputs, parameters) {
		const s = sampleRate/34125;

		this.A.entryLPF.a = this.B.entryLPF.a = parameters.bandwidth[0];
		this.A.mixedLPF.a = this.B.mixedLPF.a = parameters.damping[0];
		this.A.dif3APNa.decay = this.A.dif4APNa.decay = this.A.dif4APNb.decay = 
		this.B.dif3APNa.decay = this.B.dif4APNa.decay = this.B.dif4APNb.decay = parameters.decay1[0];
		this.A.dif2APF.k = this.B.dif2APF.k = parameters.diffusion1[0];
		this.A.dif1APF.decay = this.A.dif3APN.decay = this.A.dif4APN.decay
		this.B.dif1APF.decay = this.B.dif3APN.decay = this.B.dif4APN.decay = parameters.decay2[0];
		this.A.dif1APF.k = this.B.dif1APF.k = parameters.diffusion2[0];
		this.A.dif3APNa.k = this.A.dif4APNa.k = this.A.dif4APNb.k = 
		this.B.dif3APNa.k = this.B.dif4APNa.k = this.B.dif4APNb.k = parameters.definition[0]
		this.A.dif2APF.decay = this.B.dif2APF.decay = parameters.decay3[0];
		this.A.dif3APN.k = this.A.dif4APN.k = 
		this.B.dif3APN.k = this.B.dif4APN.k = parameters.decayDiffusion[0];

		let i = 0|0;
		let input = inputs[0];
		const MIX = 0.6;
		const KEEP = 0.5;
		const IN = 0.5;

		while (i < 128) {
			for (let j = 'A', k = 'B', p=0; p < 2; [j,k] = [k,j],p++ ) {
				this[j].entryLPF.write(input[0][i]);
				this[j].entryDLY.write(this[j].entryLPF.read());
				this[j].tankLPF .write(this[k].tankOut.read())
				this[j].mixedLPF.write(  IN*this[j].entryDLY.read()  
								+   KEEP *(this[j].tankLPF.read() * (1-MIX)/2 + this[k].tankOut.read() * MIX/2));
	
				this[j].dif1APF.write(this[j].mixedLPF.read());
				this[j].dif1DLY.write(this[j].dif1APF.read());
				this[j].dif2APF.write(this[j].dif1DLY.read());
				this[j].dif2DLY.write(this[j].dif2APF.read());
	
				this[j].dif3APN.write(this[j].dif2DLY.read());
				this[j].dif3DLY.write(this[j].dif3APN.read());
				this[j].dif4APN.write(this[j].dif3DLY.read());
				this[j].tankOut.write(this[j].dif4APN.read());
			}

			outputs[0][0][i] = this.A.dif3DLY.readAt(~~(276*s)) * 0.938;
			outputs[0][1][i] = this.B.dif3DLY.readAt(~~(468*s)) * 0.438 + this.B.dif2DLY.readAt(~~(625*s)) * 0.938
							 - this.A.dif3DLY.readAt(~~(312*s)) * 0.438 + this.B.tankOut.readAt(~~(8*s)) * 0.125;

			outputs[0][2][i] = this.B.dif3DLY.readAt(~~( 24*s)) * 0.938 + this.A.tankOut.readAt(~~(36*s)) * 0.469;
			outputs[0][3][i] = this.A.dif3DLY.readAt(~~( 40*s)) * 0.438 + this.A.dif2DLY.readAt(~~(225*s)) * 0.938
							 - this.B.dif3DLY.readAt(~~(192*s)) * 0.438 + this.A.tankOut.readAt(~~(1572*s)) * 0.469;

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
	// i must be positive.
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
		this.tape = new Delay(length + depth*2);
		this.depth = depth;
		this.rate = rate;
		this.phase = Math.random();
	}

	update() {
		this.tape.update();
		this.phase += 2*Math.PI * this.rate;
	}

	write(input) {
		return this.tape.write(input);
	}

	read() {
		return this.tape.readCubicAt((Math.cos(this.phase)+1)*this.depth);
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
		return this.d.write(this.inputNode = this.d.read() * this.k + input);
	}

	read() {
		return (this.d.read() * this.decay) + (this.inputNode * this.k * -1);
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
		this.outputNode = 0.0;
		this.dfDelay = defaultDelay;

		if (!defaultDelay) this.read = this.read2;

		return this;
	}

	update () {
		this.d.update();
		for (let i = 0; i < this.nested.length; i++)
			this.nested[i].update();
	}

	write(input) {
		this.inputNode = this.d.read() * this.k + input;
		this.outputNode = this.inputNode;
		for (let i = 0; i < this.nested.length; i++) {
			this.nested[i].write(this.outputNode);
			this.outputNode = this.nested[i].read();
		}
		return this.d.write(this.outputNode);
	}
	
	read2() {
		return this.outputNode * this.decay + this.inputNode * this.k * -1;
	}

	read() {
		return this.d.read() * this.decay + this.inputNode * this.k * -1;
	}
}

class OnePoleLP {
	constructor(bwidth) {
		this.d = 0.0;
		this.a = bwidth;
		this.inputNode = 0.0;
	}

	update() { }

	write(input) {
		return this.d = this.inputNode = this.d * (1 - this.a) + input * this.a;;
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

	update() { }

	write(input) {
		return this.d = this.inputNode = input;
	}

	read() {
		return this.inputNode * this.k + this.d * (1 - this.k);
	}
}

registerProcessor('ProgenitorReverb', ProgenitorReverb);