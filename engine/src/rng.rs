//! Deterministic RNG surface for the engine.
//!
//! Slice 2 will port the event-queue RNG semantics. The JS engine uses
//! `Math.random()` (uniform f64 in [0,1)); for parity testing we need a
//! reproducible stream, so we expose xorshift128+ (same generator family
//! V8 uses, seeded) for deterministic runs on both sides.

/// xorshift128+ generator producing uniform f64 in [0, 1).
pub struct DeterministicRng {
    s0: u64,
    s1: u64,
}

impl DeterministicRng {
    pub fn new(seed: u64) -> Self {
        // splitmix64 to expand the seed into two non-zero state words
        let mut z = seed.wrapping_add(0x9E3779B97F4A7C15);
        let mix = |z: &mut u64| -> u64 {
            *z = z.wrapping_add(0x9E3779B97F4A7C15);
            let mut x = *z;
            x = (x ^ (x >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
            x = (x ^ (x >> 27)).wrapping_mul(0x94D049BB133111EB);
            x ^ (x >> 31)
        };
        DeterministicRng { s0: mix(&mut z), s1: mix(&mut z) }
    }

    /// Uniform f64 in [0, 1) — matches the distribution of `Math.random()`.
    pub fn next_f64(&mut self) -> f64 {
        let x = self.next_u64();
        // V8-style conversion: 53-bit mantissa into [0,1)
        (x >> 11) as f64 * (1.0 / 9007199254740992.0)
    }

    /// Raw u64 stream (xorshift128+).
    pub fn next_u64(&mut self) -> u64 {
        let mut s1 = self.s0;
        let s0 = self.s1;
        let result = s0.wrapping_add(s1);
        s1 ^= s1 << 23;
        self.s0 = s0 ^ s1 ^ (s1 >> 17) ^ (s0 >> 26);
        self.s1 = s1;
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rng_is_deterministic_per_seed() {
        let mut a = DeterministicRng::new(42);
        let mut b = DeterministicRng::new(42);
        for _ in 0..1000 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
    }

    #[test]
    fn rng_values_in_unit_interval() {
        let mut rng = DeterministicRng::new(1);
        for _ in 0..10_000 {
            let v = rng.next_f64();
            assert!((0.0..1.0).contains(&v), "value out of range: {v}");
        }
    }

    #[test]
    fn different_seeds_diverge() {
        let mut a = DeterministicRng::new(1);
        let mut b = DeterministicRng::new(2);
        let mut same = true;
        for _ in 0..10 {
            if a.next_u64() != b.next_u64() {
                same = false;
            }
        }
        assert!(!same);
    }

    #[test]
    fn mean_is_approximately_uniform() {
        let mut rng = DeterministicRng::new(7);
        let n = 100_000;
        let sum: f64 = (0..n).map(|_| rng.next_f64()).sum();
        let mean = sum / n as f64;
        assert!((mean - 0.5).abs() < 0.01, "mean drifted: {mean}");
    }
}
