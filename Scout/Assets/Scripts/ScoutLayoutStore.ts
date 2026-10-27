/** Named layouts saved on the device between Lens sessions (persistentStorageSystem). Each layout's data
 * lives under its own key so the index stays tiny and one corrupt layout can't take out the rest. */
export type SavedLayoutInfo={id:string;name:string;count:number;savedAt:number};
const INDEX_KEY="scout.layouts";
const LAYOUT_KEY_PREFIX="scout.layout.";
export const MAX_SAVED_LAYOUTS=6;

export class ScoutLayoutStore {
  private store=global.persistentStorageSystem.store;

  list():SavedLayoutInfo[] {
    try{
      const raw=this.store.has(INDEX_KEY)?this.store.getString(INDEX_KEY):"";
      const list=raw?JSON.parse(raw):[];
      return Array.isArray(list)?list:[];
    }catch(e){
      console.warn("Scout layouts: unreadable index, starting fresh");
      return [];
    }
  }
  get(id:string):SavedLayoutInfo {return this.list().find(l=>l.id===id)||null;}
  /** "Untitled", then "Untitled 2", "Untitled 3"… — the first one not already taken. */
  nextUntitledName():string {
    const names=new Set(this.list().map(l=>l.name));
    if(!names.has("Untitled"))return "Untitled";
    let n=2;while(names.has("Untitled "+n))n++;
    return "Untitled "+n;
  }
  /** Returns null when storage is full or the save failed. */
  save(name:string,data:string,count:number):SavedLayoutInfo {
    const list=this.list();
    if(list.length>=MAX_SAVED_LAYOUTS)return null;
    const info:SavedLayoutInfo={id:Date.now().toString(36),name,count,savedAt:Date.now()};
    try{
      this.store.putString(LAYOUT_KEY_PREFIX+info.id,data);
      this.writeIndex([info,...list]);
      if(this.store.getSizeInBytes()>this.store.getMaxSizeInBytes())throw new Error("storage full");
      return info;
    }catch(e){
      console.warn("Scout layouts: save failed — "+e);
      this.store.remove(LAYOUT_KEY_PREFIX+info.id);
      this.writeIndex(list);
      return null;
    }
  }
  load(id:string):string {
    const key=LAYOUT_KEY_PREFIX+id;
    return this.store.has(key)?this.store.getString(key):null;
  }
  rename(id:string,name:string):void {
    this.writeIndex(this.list().map(l=>l.id===id?{...l,name}:l));
  }
  remove(id:string):void {
    this.store.remove(LAYOUT_KEY_PREFIX+id);
    this.writeIndex(this.list().filter(l=>l.id!==id));
  }
  private writeIndex(list:SavedLayoutInfo[]):void {
    this.store.putString(INDEX_KEY,JSON.stringify(list));
  }
}
