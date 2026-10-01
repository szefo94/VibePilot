# What makes fighter-plane games good

A design study for VibePilot. It covers what the well-loved fighter-plane games do (Ace Combat, Project Wingman, Luftrausers, War Thunder's arcade mode, Star Fox, Rogue Squadron, Crimson Skies, Sky Rogue), why each of their "gimmicks" works, and what that means for this game.

Legend for the VibePilot column: ✅ have it · ◐ partly · ✗ missing.

---

## The short version

The good arcade flight games share a few traits:

1. **Easy to fly, hard to master.** Ace Combat is the reference. You can fly its jets without reading a manual, yet the controls hide real depth: energy, turning circles, missile timing.
2. **Every second has a decision.** Chase or break off, use the flare now or later, keep the combo going or back off and heal.
3. **Threats you can read** by sound, screen and radar, with a clear answer to each.
4. **Speed you can feel**, not just a number on the HUD.
5. **Memorable opponents**: named aces with a story, not just more hit points.
6. **Hand-made rhythm.** Set pieces beat pure randomness: reviewers of the roguelike *Sky Rogue* missed the authored pacing of Ace Combat missions.
7. **Reasons to play one more time**: scores, medals, unlocks, ranks.

---

## 1. Flight feel and skill expression

| Gimmick | Who does it | Why it works | VibePilot |
|---|---|---|---|
| **Arcade flight with weight** | Ace Combat, Project Wingman | No stalls or spins to fight, but planes carry momentum: turning bleeds speed, diving gains it. Simple to learn, with something left to master | ✅ Rate-limited flight, a speed boost when diving |
| **High-G turn** (brake and pull together) | Ace Combat | A tighter turn that costs a lot of speed. It is the panic button against missiles and for reversals, and it rewards timing | ✗ |
| **Post-stall manoeuvres** (Cobra, Kulbit) | Ace Combat 7 | Flick the nose round to get behind a chaser, at the price of nearly all your energy, so you are a sitting duck afterwards. High risk, high reward, spectacular | ✗ |
| **Stunt moves on a meter** | Crimson Skies | Barrel rolls and Immelmann turns from a stick gesture, limited by a recharging meter. They look flashy at first, then become essential for dodging fire and quick 180° turns | ✗ |
| **Energy (speed + height) as the real resource** | Ace Combat, Project Wingman (which removed the high-G turn to force throttle control) | Gives dogfights a layer of strategy beyond pointing at the enemy | ◐ The physics has it; nothing on the HUD teaches it |
| **Automatic U-turn at the arena edge** | Star Fox all-range mode | No death by invisible wall: at the edge the plane loops back into the fight | ✗ Leaving the map counts as a crash |

**For VibePilot:**
- **High-G turn:** an "air brake and pull" that doubles the pitch rate for about 1.5 s and costs about 40% of speed. It would give the existing missiles and flares a second, skill-based answer.
- **Edge turn:** replace the out-of-bounds crash with an automatic half-loop back toward the middle. Warn first, as now, then take over.
- **One stunt later:** a single gesture-triggered barrel roll that dodges bullets, on a cooldown. It also works well on phones.

---

## 2. Speed you can feel

The game-feel literature agrees: speed is sold by the camera and sound, not by the number on the HUD. The usual tools are:
- a field of view that widens with speed
- speed lines that scale with speed
- light camera shake, kept subtle so it doesn't disorient
- parallax against nearby objects
- wind noise that rises with speed

| Gimmick | Why it works | VibePilot |
|---|---|---|
| FOV widens with speed (and narrows when braking) | The cheapest and strongest cue; a wider view reads as faster | ✗ Fixed FOV |
| Speed lines / wind streaks | Motion in the edges of your vision | ✗ (ROADMAP V7) |
| Camera shake on hits, near explosions and at top speed | Physical punch; keep it subtle and optional | ✗ (ROADMAP V8) |
| Engine pitch and wind tied to speed | Audio carries half the feel | ✅ Engine hum and wind |
| Low flying near terrain | Parallax and danger together | ✅ Terrain, PULL UP warning |

**For VibePilot:** FOV is the cheapest win: a few lines easing the camera FOV between about 70° and 82° with speed and dive boost. Add a "Screen shake" setting, on by default and switchable off for comfort.

---

## 3. Threats you can read

| Gimmick | Who does it | Why it works | VibePilot |
|---|---|---|---|
| **Escalating missile warning tone**: a slow beep when tracked, a fast beep when locked, a solid tone when a missile closes, plus a voice | Ace Combat | Teaches flare timing by ear: flare on the solid tone. Turns a hidden mechanic into a skill | ◐ On-screen MISSILE / LOCKING text, no tone |
| **Limited flares that reset per sortie** | Ace Combat | A scarce resource you have to time | ✅ Flares with reload |
| **Hit direction arcs** | Most modern shooters | You know where to look | ✅ |
| **Lead marker** (where to aim at a crossing target) | War Thunder arcade | Makes gunnery learnable without hiding it: players know it predicts straight flight, so turning targets still need skill | ✗ (the laser shows only the gun line) |
| **Radar with friend/foe/objective symbols** | Star Fox, Ace Combat | One glance shows the battle | ✅ Minimap |
| **Targets ranked by importance** (the star rankings) | Ace Combat 7 multiplayer | Marks the top three players as stars; shooting a star scores more, so the best players become prey | ✗ |

**For VibePilot:**
- **Missile tone:** a three-stage warning in audio. Ace locking: slow beeps. Locked: fast beeps. Missile within about 300 units: a solid tone. Plus the existing text.
- **Lead marker:** a small circle ahead of the locked target, at its predicted position when bullets arrive. VibePilot already computes this for the aces (`leadPoint` in `rival.js`).

---

## 4. Risk and reward in the score

| Gimmick | Who does it | Why it works | VibePilot |
|---|---|---|---|
| **Fast-decaying combo multiplier** (up to 20×) | Luftrausers | The multiplier evaporates if you stop killing. Holding fire regenerates health but resets the combo, a constant risk-versus-reward choice | ◐ Up to 4× for kills within seconds, shown briefly |
| **Close-range and style bonuses** | Ace Combat score counter, Luftrausers | Rewards getting in close and flying boldly rather than sniping from afar | ✗ (ROADMAP G19) |
| **Points per target value** | Ace Combat 7 multiplayer | Better planes and bigger threats are worth more | ◐ XP per unit type; TDM kills all count 1 |

**For VibePilot:**
- **Combo HUD:** a visible combo bar under the score (`×3 · 2.4 s`) that drains in real time, so the risk is felt.
- **Close-kill bonus:** gun kills under 150 units worth ×1.5, shown in the kill feed ("CLOSE +50%").
- **Multiplayer bounty:** the top scorer of each team is marked ★, and shooting them down is worth double XP and 2 team points. Cheap, and it gives every match a story.

---

## 5. Memorable opponents

| Gimmick | Who does it | Why it works | VibePilot |
|---|---|---|---|
| **Named ace squadrons** with a colour scheme, call signs and radio lines | Ace Combat, Project Wingman | The enemy has a face; beating *Strzyga* feels different from killing the 40th fighter | ◐ Named aces, levels, banners |
| **Radio chatter** from wingmen, controllers (AWACS) and enemy aces | Ace Combat, Project Wingman | Carries story and status without menus: "Fox two!", "Missile on your six!", "Splash one!" | ✗ |
| **Bosses with phases and weak points** | Ace Combat (fleets, superweapons), Star Fox | Set pieces that change the fight halfway through | ◐ Carriers and bases, no phases |
| **Fair aces** | Project Wingman (criticised for over-tanky aces) | Too much HP turns a duel into a slog; aces should be dangerous, not spongy | ✅ Aces must spot you first, turn more gently, level up |

**For VibePilot:**
- **Radio lines** as short subtitle callouts in a small comms box, with a callsign and colour. Text only for now, voice later. Triggers: ace spotted, missile launch, wingman kill, base down, low HP. The notification system already has the events.
- **Ace personalities:** each ace callsign gets a tactic. *Licho* prefers missiles from range; *Bies* hugs the ground; *Żmij* fakes retreats. The tier settings already allow per-ace tuning.

---

## 6. Variety, structure and progression

| Gimmick | Who does it | Why it works | VibePilot |
|---|---|---|---|
| **Unlockable planes and parts** that change how you fly | Ace Combat, Luftrausers (125 combinations of weapon, body and engine) | Different play styles, a long-term goal | ◐ Levels raise HP, damage and ammo; one airframe |
| **Medals for a run** (bronze, silver, gold) from time, accuracy and losses, unlocking extras | Rogue Squadron | Replay value in short, measurable goals | ◐ Debrief with outcome, no medal |
| **Varied objectives**: search and destroy, recon, rescue, protect | Rogue Squadron | Stops every mission feeling like "kill everything" | ◐ Bases, constellations, rings, tubes |
| **Switching vehicles and manning turrets** | Crimson Skies | Surprising options; turrets added strategy to online play | ✗ |
| **Authored set pieces over pure randomness** | Ace Combat vs Sky Rogue | Rhythm: calm, build-up, climax | ◐ Seeded maps, the mission panel, aces after 90 s |
| **Weather that matters**: clouds hide you but block locks, icing, lightning disturbs the HUD | Ace Combat 7 | The sky becomes terrain: hide in clouds to break a lock, at a price | ◐ Day and night, decorative clouds |

**For VibePilot:**
- **Medals:** a debrief medal from time, accuracy and damage taken. It fits the existing debrief and seeded "Replay this map".
- **Cloud banks:** a few volumes over the sea. Inside, the minimap and lock-on don't work for or against you, and aces lose sight of you. Uses the existing sight model (`acquire()` in `rival.js`).
- **Airframes:** a second player airframe later (fast and fragile vs slow and tanky), using the ace model. Choose it on the start screen.

---

## 7. Multiplayer

| Gimmick | Who does it | Why it works | VibePilot |
|---|---|---|---|
| **Score per kill weighted by the victim's value** | Ace Combat 7 TDM and Battle Royal | Upsets and comebacks: hunting the leader pays | ◐ K/D and team score, every kill worth 1 |
| **Short matches with a clear end** | Every online mode | A win or a loss gives closure | ✗ Unlimited score |
| **Arcade aids on by default**: markers on friends and foes, unlimited respawns, guns reloading in flight | War Thunder arcade | New players can contribute immediately | ✅ Markers, respawn, reloads |
| **Bots that fill teams** | Many | Matches start at any player count | ✅ Team bots |

**For VibePilot:**
- **Match end:** first team to 25 kills, or 10 minutes. Show the result, then start a new round in the same room.
- **Bounties:** the ★ idea from §4.

---

## Recommended order for VibePilot

Picked for the most effect per hour of work, building on systems that already exist:

| # | Feature | Effect | Effort | Builds on |
|---|---|---|---|---|
| 1 | **Missile warning tones** (three stages) | High: flares become a skill | Low | `audio.js`, ace lock and missile state |
| 2 | **Speed FOV + optional screen shake** | High: speed felt | Low | `scene.js` camera, settings |
| 3 | **Lead marker** on the locked target | High: gunnery learnable | Low | `leadPoint()` logic, reticle |
| 4 | **Visible combo bar + close-kill bonus** | Medium-high: risk and reward | Low | `progression.js` streak |
| 5 | **Radio callouts** (text comms box) | Medium-high: personality | Medium | notifications, hooks |
| 6 | **High-G turn** | Medium: skill and evasion | Medium | `flight.js` rates |
| 7 | **Edge U-turn instead of crash** | Medium: fewer cheap deaths | Low | boundary warning |
| 8 | **TDM match end + ★ bounties** | High in multiplayer | Medium | server score and stats |
| 9 | **Debrief medals** | Medium: replay value | Low | debrief, seeds |
| 10 | **Cloud banks that block sight and locks** | High: new tactics | High | sky, `acquire()` |
| 11 | **Second airframe** | Medium: variety | Medium | ace model, settings |

Items 1–4 together are a small amount of work and would change how the game feels the most. They are also the things reviewers praise first in Ace Combat: flying that is readable, fast and rewarding.

---

## Sources

- [Ace Combat 7: Skies Unknown full review](https://stormbirds.blog/2021/02/21/ace-combat-7-skies-unknown-full-review/), [Ace Combat PC alternatives](https://www.pcgamesn.com/ace-combat-pc) and [Ace Combat 8 review](https://www.analogstickgaming.com/game-reviews/ace-combat-8-wings-of-theve): accessibility, pace, weight, unlocks, music
- [Ace Combat 7 (Ace Combat Wiki)](https://acecombat.wiki.gg/wiki/Ace_Combat_7:_Skies_Unknown), [Post Stall Maneuver](https://acecombat.wiki.gg/wiki/Post_Stall_Maneuver) and [The Making of Ace Combat 7](https://www.bandainamcostudios.com/en/behind-the-game/205): clouds, icing, lightning, post-stall manoeuvres
- [High-G Turn](https://acecombat.fandom.com/wiki/High-G_Turn), [Evading missiles (Steam)](https://steamcommunity.com/app/502500/discussions/0/2277079183721884353/) and [How to use flares](https://www.gamepressure.com/ace-combat-7/how-to-use-flares/zebcc6): warning tones, flares, energy
- [Ace Combat 7 multiplayer details (Gematsu)](https://www.gematsu.com/2018/12/ace-combat-7-skies-unknown-details-multiplayer-mode) and [Team Deathmatch](https://acecombat.fandom.com/wiki/Team_Deathmatch): points per plane, star rankings
- [Luftrausers review (VideoGamer)](https://www.videogamer.com/reviews/luftrausers-review/) and [Luftrausers (Cubed3)](https://www.cubed3.com/games/reviews/pc/luftrausers): combo multiplier, risk and reward, 125 plane builds
- [Project Wingman review (TheGamer)](https://www.thegamer.com/project-wingman-review/) and [Review of Project Wingman (Pixel Judge)](https://pixeljudge.com/reviews/project-wingman/): radio chatter, aggressive AI, over-tanky aces, no high-G turn
- [War Thunder Arcade Battles](https://wiki.warthunder.com/gamemode/arcade_battles), [Air Arcade beginner's guide](http://www.clocloz.altervista.org/wt/War_Thunder_Air_Battles_Beginners_Guide.html) and [lead indicator discussion](https://forum.warthunder.com/t/what-is-the-point-of-the-aaa-lead-indicator-in-arcade/7544): arcade aids, lead marker
- [All-Range Mode (Star Fox wiki)](https://starfox.fandom.com/wiki/All-Range_Mode): arena edge U-turn, radar
- [Star Wars: Rogue Squadron](https://en.wikipedia.org/wiki/Star_Wars:_Rogue_Squadron) and [Rogue Squadron retrospective](https://arbrasch.medium.com/a-rogue-squadron-retrospective-2b3a4f4fcbd2): medals, objective types, unlocks
- [Crimson Skies: High Road to Revenge](https://en.wikipedia.org/wiki/Crimson_Skies:_High_Road_to_Revenge) and [GameSpot review](https://www.gamespot.com/reviews/crimson-skies-high-road-to-revenge-review/1900-6077239/): stunt meter, turrets, switching planes
- [Sky Rogue review (Nintendo Life)](https://www.nintendolife.com/reviews/switch-eshop/sky_rogue) and [Sky Rogue review (XboxHub)](https://www.thexboxhub.com/sky-rogue-review/): roguelike randomness vs authored set pieces
- [Adding the Feeling of Speed](https://elliotdev.gg/adding-the-feeling-of-speed/), [Game feel (Wikipedia)](https://en.wikipedia.org/wiki/Game_feel) and [Designing Game Feel: A Survey](https://arxiv.org/pdf/2011.09201): FOV, speed lines, shake, parallax
