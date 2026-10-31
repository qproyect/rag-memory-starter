import { pool } from "./client.js";
import { generateDeterministicEmbedding } from "../providers/types.js";

export interface SeedNote {
  text: string;
  metadata: {
    category: "cooking" | "travel" | "history" | "science";
    topic: string;
    source: string;
  };
}

export const sampleNotes: SeedNote[] = [
  {
    text: "The Maillard reaction is a chemical reaction between amino acids and reducing sugars that gives browned food its distinctive flavor, typically occurring above 140°C (284°F).",
    metadata: { category: "cooking", topic: "chemistry", source: "culinary-basics" },
  },
  {
    text: "Sous-vide cooking involves sealing food in an airtight container and cooking it in a temperature-controlled water bath to ensure even doneness without overcooking.",
    metadata: { category: "cooking", topic: "technique", source: "modernist-cuisine" },
  },
  {
    text: "Sourdough bread relies on naturally occurring yeasts and lactic acid bacteria (Lactobacillus) in a fermented starter to achieve rising and a characteristic tangy flavor.",
    metadata: { category: "cooking", topic: "baking", source: "artisan-bread" },
  },
  {
    text: "Emulsification in culinary science is the process of combining two liquids that normally do not mix, such as oil and water, often stabilized by lecithin in egg yolk for mayonnaise.",
    metadata: { category: "cooking", topic: "sauces", source: "food-lab" },
  },
  {
    text: "Deglazing is a cooking technique where liquid like wine or stock is added to a hot pan to dissolve browned food residue (fond) sticking to the bottom, forming the base of a sauce.",
    metadata: { category: "cooking", topic: "technique", source: "french-culinary" },
  },
  {
    text: "Kyoto, Japan, served as the imperial capital for over a millennium and contains more than 1,600 historic Buddhist temples and 400 Shinto shrines.",
    metadata: { category: "travel", topic: "asia", source: "unesco-heritage" },
  },
  {
    text: "Machu Picchu is a 15th-century Inca citadel situated on a mountain ridge in the Eastern Cordillera of southern Peru, 2,430 meters above sea level.",
    metadata: { category: "travel", topic: "south-america", source: "world-wonders" },
  },
  {
    text: "The Great Barrier Reef off the coast of Queensland, Australia, is the world's largest coral reef system, composed of over 2,900 individual reefs.",
    metadata: { category: "travel", topic: "oceania", source: "marine-biology" },
  },
  {
    text: "Reykjavik, Iceland, is the northernmost capital city of a sovereign state and is powered almost entirely by geothermal and hydroelectric energy.",
    metadata: { category: "travel", topic: "europe", source: "nordic-geography" },
  },
  {
    text: "The Serengeti National Park in Tanzania hosts the annual Great Migration, where over 1.5 million wildebeest and hundreds of thousands of zebras cross the Mara River.",
    metadata: { category: "travel", topic: "africa", source: "wildlife-guide" },
  },
  {
    text: "The Library of Alexandria in Ptolemaic Egypt was one of the largest and most significant libraries of the ancient world, flourishing under royal patronage.",
    metadata: { category: "history", topic: "ancient-world", source: "classical-studies" },
  },
  {
    text: "The Silk Road was an ancient network of Eurasian trade routes active from the Han dynasty until the Ottoman Empire boycotted trade with the West in the 1450s.",
    metadata: { category: "history", topic: "trade", source: "world-history" },
  },
  {
    text: "The invention of the movable-type printing press by Johannes Gutenberg in Mainz around 1440 initiated the European printing revolution and mass dissemination of knowledge.",
    metadata: { category: "history", topic: "renaissance", source: "technology-history" },
  },
  {
    text: "The Rosetta Stone, carved in 196 BC, provided the modern key to deciphering ancient Egyptian hieroglyphs because its decree appeared in hieroglyphic, Demotic, and Ancient Greek.",
    metadata: { category: "history", topic: "archaeology", source: "british-museum" },
  },
  {
    text: "The construction of the Panama Canal, completed in 1914, connected the Atlantic and Pacific oceans, drastically shortening maritime transit routes around Cape Horn.",
    metadata: { category: "history", topic: "engineering", source: "maritime-history" },
  },
  {
    text: "Photosynthesis is the biological process used by plants and algae to convert light energy into chemical energy stored in glucose molecules, releasing oxygen as a byproduct.",
    metadata: { category: "science", topic: "biology", source: "plant-physiology" },
  },
  {
    text: "General relativity describes gravity not as an invisible attractive force between masses, but as a curvature of spacetime caused by mass and energy.",
    metadata: { category: "science", topic: "physics", source: "astrophysics" },
  },
  {
    text: "Plate tectonics explains the large-scale motion of seven large plates and numerous smaller plates of Earth's lithosphere over geologic time scales.",
    metadata: { category: "science", topic: "geology", source: "earth-sciences" },
  },
  {
    text: "The human genome comprises approximately 3 billion DNA base pairs organized into 23 pairs of chromosomes within the nucleus of almost every somatic cell.",
    metadata: { category: "science", topic: "genetics", source: "molecular-biology" },
  },
  {
    text: "Superconductivity is a set of physical properties observed in certain materials where electrical resistance drops to zero below a critical transition temperature.",
    metadata: { category: "science", topic: "materials", source: "solid-state-physics" },
  },
];

export async function seedMemories(): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let count = 0;
    for (const note of sampleNotes) {
      const embedding = generateDeterministicEmbedding(note.text, 384);
      const vectorStr = `[${embedding.join(",")}]`;

      await client.query(
        `
        INSERT INTO memories (text, metadata, embedding)
        VALUES ($1, $2, $3::vector)
        ON CONFLICT (id) DO NOTHING;
      `,
        [note.text, JSON.stringify(note.metadata), vectorStr]
      );
      count++;
    }

    await client.query("COMMIT");
    console.log(`Successfully seeded ${count} sample memories.`);
    return count;
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Seeding failed:", error);
    throw error;
  } finally {
    client.release();
  }
}

// Execute directly if run via CLI
if (process.argv[1] && process.argv[1].endsWith("seed.ts")) {
  seedMemories()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
