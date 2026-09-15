/** Name pools and counters for bases, fleets, squadrons, constellations and corridors. */
// --- Base / Fleet Names ---
export const aibaseLetters    = ['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot','Golf','Hotel','India','Juliet'];
export const forwardBaseNames = ['Achilles','Ajax','Hector','Leonidas','Brasidas','Lysander','Themistocles','Epaminondas'];
export const fleetNames       = ['Poseidon','Neptune','Triton','Leviathan','Aegir','Kraken','Tethys','Nereid'];
export const squadronNames    = ['Ares','Mars','Artemis','Orion','Thor','Odin','Sirius','Polaris'];
export const hoverWingNames   = ['Icarus','Pegasus','Hermes','Valkyrie','Zephyr','Aura'];
export const strikeWingNames  = ['Apollo','Talon','Falcon','Hawk','Raptor','Griffin'];
export const CONSTELLATION_NAMES = ['Orion','Cassiopeia','Perseus','Andromeda','Lyra','Aquila','Cygnus','Scorpius','Leo','Gemini','Taurus','Aries','Pisces','Sagittarius','Draco','Hercules','Pegasus','Ophiuchus','Centaurus','Vela'];
export const CORRIDOR_NAMES = ['Corridor Alpha','Corridor Beta','Corridor Gamma','Corridor Delta','Corridor Epsilon','Corridor Zeta','Corridor Eta','Corridor Theta'];
// Constellation / corridor tracking maps (id → { name, total, remaining, completed })
export const constellations = {}, corridors = {};
