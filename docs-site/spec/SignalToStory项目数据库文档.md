# SignalToStory项目数据库文档



# 系统基础





# 知识库内容



## 信息分类\(c\_category\)

|**表名：c\_category**||||
|---|---|---|---|
|**用途：资讯分类信息表**||||
|**原始表：**||||
|字段|类型|索引/键|备注|
|id|bigint 20|pk|主键的id|
|sort\_id|Int||用户的ID|
|parent\_id|bigint 20||父级的主键ID|
|name|Varchar 36||信息分类的名称|
|icon\_url|Varchar 128||图标的显示url|
|status|int||状态<br>1：启用<br>0：禁用|
|description|varchar 256||资产描述|
|create\_id|long||创建人|
|create\_time|datetime||创建时间|
|modify\_id|long||修改人|
|modify\_time|datetime||修改时间|



## 资源及信息资源\(c\_signal\)

|**表名：c\_singal**||||
|---|---|---|---|
|**用途：资源及信息收集信息表**||||
|**原始表：**||||
|字段|类型|索引/键|备注|
|id|bigint 20|pk|主键的id|
|category\_id|Bigint 20|**c\_category 的主键ID**|信息分类的主键ID|
|name|Varchar 36||信息分类的名称|
|icon\_url|Varchar 128||图标的显示|
|site\_url|Varchar 128||资源链接的URL|
|sumary|Varchar 1024||摘要信息|
|description|text||备注和描述信息|
|status|int||状态<br>1：未整理<br>0：已整理|
|create\_id|long||创建人|
|create\_time|datetime||创建时间|
|modify\_id|long||修改人|
|modify\_time|datetime||修改时间|



## 选题信息表\(selection\)

|**表名：c\_selection**||||
|---|---|---|---|
|**用途：选题信息管理表**||||
|**原始表：**||||
|字段|类型|索引/键|备注|
|id|bigint 20|pk|主键的id|
|signal\_id|Bigint 20|**c\_singal 的主键ID**|信息源的主键ID|
|name|Varchar 64||标题/暂定选题名|
|core\_thesis|Varchar 512||核心论点/一句话立意|
|angle\_type|Varchar 64||切入角度|
|content\_format|Varchar 64||内容形式|
|negative\_prompts|text||内容禁忌/负向约束|
|outline\_template|JSON||预设结构大纲/章节模板\(JSON Array\)|
|priority|int<br>||优先级<br>1：高<br>2：中<br>3：低|
|status|int||专题<br>1：未完成<br>0：已完成|
|description|varchar 256||资产描述信息|
|create\_id|long||创建人编号|
|create\_time|datetime||创建时间|
|modify\_id|long||修改人|
|modify\_time|datetime||修改时间|



# 资源管理

## 提示词与图例（prompt_examples）

| 字段 | 类型 | 备注 |
| --- | --- | --- |
| id | bigint | 主键 ID |
| organization_id | uuid | 所属组织 |
| title | text | 名称 |
| prompt_text | text | 正向提示词正文 |
| negative_prompt | text | 负向提示词，可空 |
| example_image_url | text | 外部图例地址，可空 |
| example_storage_path | text | 私有 Supabase Storage 图例对象路径，可空 |
| example_asset_id | bigint | 已导入资产库的图片资产，可空 |
| source_url / source_author | text | 网络原始链接与作者，可空 |
| origin_type | text | `collected` 网络收集 / `self_created` 自己创作 |
| tags | text[] | 最多 12 个标签 |
| status | text | `inbox` 待整理 / `curated` 已收藏 / `archived` 已归档 |
| visibility | text | `private` 私有 / `shared` 可共享标记；当前不公开 |
| notes | text | 备注、使用心得，可空 |
| created_by / created_at / updated_by / updated_at | uuid / timestamptz | 审计字段 |

提示词与图例是创作参考，不替代图片资产；需要长期保存或复用的图例可同步登记到 `assets`，然后使用 `example_asset_id` 关联。浏览器上传的图例存放在私有 `prompt-examples` Storage bucket；网页只按当前账号权限取得短时签名预览地址，不公开对象 URL。



## 故事剧本\(c\_story\)

|**表名：c\_story**||||
|---|---|---|---|
|**用途：故事和基本信息表**||||
|**原始表：**||||
|字段|类型|索引/键|备注|
|id|bigint 20|pk|主键的id|
|sort\_id|Int||用户的ID|
|parent\_id|bigint 20||父级的主键ID|
|name|Varchar 36||信息分类的名称|
|icon\_url|Varchar 128||图标的显示|
|||||
|status|int||状态<br>1：启用<br>0：禁用|
|description|varchar 256||资产描述|
|create\_id|long||创建人编号|
|create\_time|datetime||创建时间|
|modify\_id|long||修改人|
|modify\_time|datetime||修改时间|



## 分镜头



## 角色设置



## 场景美术



## 资产管理\(c\_assets\)

|**表名：c\_assets**||||
|---|---|---|---|
|**用途：资讯的类型管理表**||||
|**原始表：**||||
|字段|类型|索引/键|备注|
|id|bigint|pk|主键的id|
|user\_id|Int||用户的ID|
|org\_id|||所属组织的ID|
|story\_id|||故事的主键ID|
|type<br>|Int ||分类的名称<br>1：角色<br>2：场景<br>3：道具<br>4：音频<br>5：风格|
|category|int||二级分类<br>1：饮食|
|name|varchar 32||资产的名字|
|cloud\_url|varchar 256||云端资产的url|
|local\_url|varchar 256||本地资产的URL|
|status|int||状态<br>1：启用<br>0：禁用|
|description|varchar 256||资产描述|
|create\_id|long||创建人编号|
|create\_time|datetime||创建时间|
|modify\_id|long||修改人|
|modify\_time|datetime||修改时间|

